#!/usr/bin/env node
/**
 * Headless TV communication test script.
 *
 * Loads the paired device + certs from disk, opens a TLS connection to the
 * TV, and runs a sequence of operations. Reports every inbound message from
 * the TV so you can verify it's responding correctly.
 *
 * Usage:
 *   node scripts/tv-test.mjs              # uses first saved device
 *   node scripts/tv-test.mjs 192.168.1.9  # explicit host
 *
 * Requires: npm run build (so dist-electron/ exists for the protobuf codec)
 *
 * Operations performed:
 *   1. TLS connect + protocol handshake
 *   2. Send HOME key
 *   3. Wait 1s → send BACK key
 *   4. Wait 1s → send UP arrow
 *   5. Wait 1s → send DOWN arrow
 *   6. Wait 1s → send SELECT
 *   7. Wait 2s → disconnect
 *
 * Watch your TV screen — each command should cause a visible reaction.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Load saved device + certs ─────────────────────────────────────────────────

const USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'GTV Remote');
const DEVICES_FILE = path.join(USER_DATA, 'devices.json');
const CERTS_DIR = path.join(USER_DATA, 'androidtvremote');

if (!fs.existsSync(DEVICES_FILE)) {
  console.error(`❌ No devices.json found at ${DEVICES_FILE}`);
  console.error('   Pair a device in the app first, then run this script.');
  process.exit(1);
}

const { devices } = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
const targetHost = process.argv[2];
const device = targetHost
  ? devices.find(d => d.host === targetHost)
  : devices.find(d => d.isPaired);

if (!device) {
  console.error(`❌ No paired device found${targetHost ? ` for host ${targetHost}` : ''}.`);
  console.error('   Available:', devices.map(d => `${d.name} (${d.host})`).join(', '));
  process.exit(1);
}

const certPath = path.join(CERTS_DIR, `${device.host}.cert.pem`);
const keyPath = path.join(CERTS_DIR, `${device.host}.key.pem`);

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error(`❌ Cert files not found for ${device.host}`);
  console.error(`   Expected: ${certPath}`);
  process.exit(1);
}

const cert = fs.readFileSync(certPath, 'utf8');
const key = fs.readFileSync(keyPath, 'utf8');

console.log(`\n📺 Target: ${device.name} (${device.host})`);
console.log(`🔐 Cert:   ${certPath}`);

// ── Load compiled protobuf codecs from dist-electron ─────────────────────────

const DIST = path.join(ROOT, 'dist-electron');
if (!fs.existsSync(DIST)) {
  console.error(`\n❌ dist-electron/ not found. Run: npm run build`);
  process.exit(1);
}

const { createRemoteKeyInject, createRemoteConfigure, createRemotePingResponse, parseRemoteMessage } =
  await import(path.join(DIST, 'backend/protocol/androidtv/remote.js'));

// ── Varint frame parser (inline — avoids module resolution issues) ─────────────

function readVarint(buf, offset) {
  let result = 0, shift = 0;
  while (offset < buf.length) {
    const byte = buf[offset++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
    if (!(byte & 0x80)) return { value: result, offset };
  }
  return null;
}

function encodeVarint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}

function frameBuffer(payload) {
  return Buffer.concat([encodeVarint(payload.length), payload]);
}

function parseFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const varint = readVarint(buffer, offset);
    if (!varint) break;
    const frameEnd = varint.offset + varint.value;
    if (frameEnd > buffer.length) break;
    frames.push(buffer.slice(varint.offset, frameEnd));
    offset = frameEnd;
  }
  return { frames, remaining: buffer.slice(offset) };
}

// ── Remote features (must match what the app sends) ───────────────────────────

const REMOTE_FEATURES = 1;

// ── Test sequence ─────────────────────────────────────────────────────────────

const COMMANDS = [
  { command: 'home',   label: '🏠 HOME',   delayAfterMs: 1500 },
  { command: 'back',   label: '⬅️  BACK',   delayAfterMs: 1500 },
  { command: 'up',     label: '⬆️  UP',     delayAfterMs: 800  },
  { command: 'down',   label: '⬇️  DOWN',   delayAfterMs: 800  },
  { command: 'left',   label: '⬅️  LEFT',   delayAfterMs: 800  },
  { command: 'right',  label: '➡️  RIGHT',  delayAfterMs: 800  },
  { command: 'select', label: '✅ SELECT',  delayAfterMs: 1500 },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let rxCount = 0;
let txCount = 0;
let protocolReady = false;

console.log(`\n🔌 Connecting to ${device.host}:6466...\n`);

const socket = tls.connect({
  host: device.host,
  port: 6466,
  cert,
  key,
  rejectUnauthorized: false,
});

let buffer = Buffer.alloc(0);

function send(payload) {
  const frame = frameBuffer(payload);
  socket.write(frame);
  txCount++;
}

socket.on('secureConnect', () => {
  console.log('✅ TLS handshake complete\n');
});

socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  const { frames, remaining } = parseFrames(buffer);
  buffer = remaining;

  for (const frame of frames) {
    rxCount++;
    try {
      const msg = parseRemoteMessage(frame);
      const key = Object.keys(msg).find(k => msg[k] !== undefined && msg[k] !== null);

      if (msg.remoteConfigure) {
        const info = msg.remoteConfigure.deviceInfo ?? {};
        console.log(`📥 [rx-${rxCount}] remoteConfigure — model: ${info.model ?? '?'}, vendor: ${info.vendor ?? '?'}, appVersion: ${info.appVersion ?? '?'}`);
        send(createRemoteConfigure(REMOTE_FEATURES));
        protocolReady = true;
        console.log('✅ Protocol handshake complete — TV is ready\n');
        socket.emit('protocol-ready');
        return;
      }

      if (msg.remotePingRequest?.val1 !== undefined) {
        send(createRemotePingResponse(msg.remotePingRequest.val1));
        console.log(`📥 [rx-${rxCount}] ping → pong (val1=${msg.remotePingRequest.val1})`);
        return;
      }

      if (msg.remoteSetActive) {
        console.log(`📥 [rx-${rxCount}] remoteSetActive`);
        return;
      }

      if (msg.remoteStart) {
        console.log(`📥 [rx-${rxCount}] remoteStart — TV is ${msg.remoteStart.started ? 'ON' : 'OFF'}`);
        return;
      }

      if (msg.remoteImeKeyInject) {
        console.log(`📥 [rx-${rxCount}] remoteImeKeyInject — app: ${msg.remoteImeKeyInject.appInfo?.appPackage ?? '?'}`);
        return;
      }

      if (msg.remoteImeBatchEdit) {
        console.log(`📥 [rx-${rxCount}] remoteImeBatchEdit`);
        return;
      }

      if (msg.remoteVoiceBegin) {
        console.log(`📥 [rx-${rxCount}] remoteVoiceBegin — sessionId: ${msg.remoteVoiceBegin.sessionId}`);
        return;
      }

      if (msg.remoteVoiceEnd) {
        console.log(`📥 [rx-${rxCount}] remoteVoiceEnd`);
        return;
      }

      console.log(`📥 [rx-${rxCount}] ${key ?? 'unknown'}: ${JSON.stringify(msg[key ?? ''] ?? msg)}`);
    } catch (e) {
      console.log(`📥 [rx-${rxCount}] <parse error: ${e.message}> hex: ${frame.toString('hex').slice(0, 40)}`);
    }
  }
});

socket.on('error', (err) => {
  console.error(`\n❌ Socket error: ${err.message}`);
  process.exit(1);
});

socket.on('close', () => {
  console.log(`\n🔌 Connection closed. tx=${txCount} rx=${rxCount}`);
  process.exit(0);
});

socket.on('timeout', () => {
  console.error('\n❌ Connection timed out');
  socket.destroy();
  process.exit(1);
});

socket.setTimeout(10_000);

// ── Wait for protocol ready then run the test sequence ────────────────────────

socket.once('protocol-ready', async () => {
  console.log('🚀 Starting test sequence...\n');
  await sleep(500);

  for (const { command, label, delayAfterMs } of COMMANDS) {
    const frame = createRemoteKeyInject(command);
    send(frame);
    txCount++; // already counted in send() but label it
    console.log(`📤 [tx-${txCount}] ${label}`);
    await sleep(delayAfterMs);
  }

  console.log('\n✅ Test sequence complete.');
  console.log(`   Sent ${txCount} frames, received ${rxCount} frames`);
  console.log('   Disconnecting in 1s...\n');
  await sleep(1000);
  socket.destroy();
});
