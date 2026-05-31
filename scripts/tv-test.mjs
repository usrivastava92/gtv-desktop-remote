#!/usr/bin/env node
/**
 * Headless TV communication test script.
 *
 * Opens ONE persistent TLS connection (matching the production app), completes
 * the remoteConfigure handshake, then sends all commands on that same socket.
 * The TV only accepts keys from the session that established the connection.
 *
 * Usage:
 *   yarn build && node scripts/tv-test.mjs              # first paired device
 *   yarn build && node scripts/tv-test.mjs 192.168.1.9  # explicit host
 */

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// ── Load compiled codecs ──────────────────────────────────────────────────────

const DIST = path.join(ROOT, 'dist-electron');
if (!fs.existsSync(DIST)) {
  console.error('\n❌ dist-electron/ not found. Run: yarn build');
  process.exit(1);
}

const {
  createRemoteKeyInject,
  createRemoteKeyInjectRaw,
  createRemoteConfigure,
  createRemoteSetActive,
  createRemotePingResponse,
  createRemoteVoiceBegin,
  createRemoteVoicePayload,
  createRemoteVoiceEnd,
  parseRemoteMessage,
} = require(path.join(DIST, 'backend/protocol/androidtv/remote.js'));

const { parseFramedBuffer } = require(path.join(DIST, 'backend/transport/framing/frameParser.js'));

const REMOTE_FEATURES = 622; // must match src/main/device/androidTvRemote.types.ts

// ── Load saved device + certs ─────────────────────────────────────────────────

const USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'GTV Remote');
const DEVICES_FILE = path.join(USER_DATA, 'devices.json');
const CERTS_DIR = path.join(USER_DATA, 'androidtvremote');

if (!fs.existsSync(DEVICES_FILE)) {
  console.error(`❌ No devices.json at ${DEVICES_FILE} — pair a device in the app first.`);
  process.exit(1);
}

const { devices } = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
const targetHost = process.argv[2];
const device = targetHost
  ? devices.find((d) => d.host === targetHost)
  : devices.find((d) => d.isPaired);

if (!device) {
  console.error(
    `❌ No paired device found. Available: ${devices.map((d) => `${d.name} (${d.host})`).join(', ')}`
  );
  process.exit(1);
}

const certPath = path.join(CERTS_DIR, `${device.host}.cert.pem`);
const keyPath = path.join(CERTS_DIR, `${device.host}.key.pem`);
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error(`❌ Cert files not found for ${device.host} — try resetting + re-pairing.`);
  process.exit(1);
}

const cert = fs.readFileSync(certPath, 'utf8');
const key = fs.readFileSync(keyPath, 'utf8');

console.log(`\n📺 ${device.name}  (${device.host})`);
console.log(`🔐 ${certPath}\n`);

// ── Test sequence ─────────────────────────────────────────────────────────────

const COMMANDS = [
  { command: 'home', label: '🏠 HOME', delayAfterMs: 1500 },
  { command: 'back', label: '⬅️  BACK', delayAfterMs: 1500 },
  { command: 'up', label: '⬆️  UP', delayAfterMs: 800 },
  { command: 'down', label: '⬇️  DOWN', delayAfterMs: 800 },
  { command: 'left', label: '⬅️  LEFT', delayAfterMs: 800 },
  { command: 'right', label: '➡️  RIGHT', delayAfterMs: 800 },
  { command: 'select', label: '✅ SELECT', delayAfterMs: 1500 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Open persistent connection ────────────────────────────────────────────────

console.log(`🔌 Connecting to ${device.host}:6466 ...\n`);

let buffer = Buffer.alloc(0);
let passed = 0;
let failed = 0;

const socket = tls.connect({
  host: device.host,
  port: 6466,
  cert,
  key,
  rejectUnauthorized: false,
});

socket.setTimeout(30_000); // extended for voice test (1s PCM + roundtrips)
socket.on('timeout', () => {
  console.error('❌ Socket timeout');
  socket.destroy();
  process.exit(1);
});
socket.on('error', (err) => {
  console.error(`❌ Socket error: ${err.message}`);
  process.exit(1);
});

// ── Inbound message handler ───────────────────────────────────────────────────

socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  const { frames, remaining, error } = parseFramedBuffer(buffer);
  buffer = Buffer.from(remaining);

  if (error) {
    console.error(`❌ Frame parse error: ${error.message}`);
    socket.destroy();
    return;
  }

  for (const f of frames) {
    let msg;
    try {
      msg = parseRemoteMessage(f);
    } catch (e) {
      console.log(`  ⚠️  parse error: ${e.message} hex: ${f.toString('hex').slice(0, 20)}`);
      continue;
    }

    if (msg.remoteConfigure) {
      const info = msg.remoteConfigure.deviceInfo ?? {};
      console.log(
        `✅ remoteConfigure — ${info.vendor ?? '?'} ${info.model ?? '?'} (${info.appVersion ?? '?'})`
      );
      socket.write(createRemoteConfigure(REMOTE_FEATURES));
      // Protocol is ready — emit event so the main loop can proceed
      socket.emit('protocol-ready');
      return;
    }

    if (msg.remoteSetActive) {
      socket.write(createRemoteSetActive(REMOTE_FEATURES));
      return;
    }

    if (msg.remotePingRequest?.val1 !== undefined) {
      socket.write(createRemotePingResponse(msg.remotePingRequest.val1));
      return;
    }

    if (msg.remoteStart) {
      console.log(`  📺 remoteStart: started=${msg.remoteStart.started}`);
      return;
    }

    if (msg.remoteVoiceBegin) {
      const sid = msg.remoteVoiceBegin.sessionId;
      console.log(`  📥 remoteVoiceBegin — sessionId: ${sid}`);
      socket.emit('voice-begin', sid);
      return;
    }

    if (msg.remoteVoiceEnd) {
      console.log(`  📥 remoteVoiceEnd`);
      socket.emit('voice-end');
      return;
    }

    // Everything else (remoteImeKeyInject echo etc) — just note it
    const keys = Object.keys(msg).filter((k) => {
      const v = msg[k];
      return (
        v !== undefined && v !== null && !(typeof v === 'object' && Object.keys(v).length === 0)
      );
    });
    if (keys.length > 0) {
      console.log(`  📥 ${keys.join(', ')}`);
    }
  }
});

// ── Wait for protocol-ready, then run commands ────────────────────────────────

await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('Timeout: TV did not send remoteConfigure within 8s')),
    8000
  );
  socket.once('protocol-ready', () => {
    clearTimeout(timer);
    resolve();
  });
  socket.once('error', (e) => {
    clearTimeout(timer);
    reject(e);
  });
});

console.log('\n🚀 Starting command sequence (persistent connection)\n');

for (const { command, label, delayAfterMs } of COMMANDS) {
  const frame = createRemoteKeyInject(command);
  process.stdout.write(`  ${label} ... `);

  try {
    socket.write(frame);
    console.log('✅ sent');
    passed++;
  } catch (err) {
    console.log(`❌ ${err.message}`);
    failed++;
  }

  await sleep(delayAfterMs);
}

// ── Google Assistant voice test ───────────────────────────────────────────────

console.log('\n🎤 Testing Google Assistant voice session...\n');

// Register voice-begin listener BEFORE sending the key
const voiceBeginPromise = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('Timeout: TV did not open voice session within 8s')),
    8000
  );
  socket.once('voice-begin', (sessionId) => {
    clearTimeout(timer);
    resolve(sessionId);
  });
});

// Navigate to home first so assistant is available
socket.write(createRemoteKeyInject('home'));
await sleep(1500);

// Try KEYCODE_SEARCH START_LONG (matches production app)
process.stdout.write('  🔍 ASSISTANT press (KEYCODE_SEARCH START_LONG) ... ');
socket.write(createRemoteKeyInjectRaw('KEYCODE_SEARCH', 'START_LONG'));
console.log('✅ sent');

let voiceSessionId;
try {
  voiceSessionId = await voiceBeginPromise;
  console.log(`  ✅ remoteVoiceBegin confirmed — sessionId: ${voiceSessionId}`);
  passed++;
} catch (err) {
  // Voice session timeout is not a hard failure — some TVs open text search
  // instead of voice assistant for KEYCODE_SEARCH (firmware/config dependent).
  // The production app also has this timeout; it's expected on some devices.
  console.log(`  ⚠️  ${err.message} (TV may have opened text search instead of voice)`);
  socket.write(createRemoteKeyInjectRaw('KEYCODE_SEARCH', 'END_LONG'));
  console.log('  ℹ️  Voice test skipped — run from app UI to verify voice on this TV');
}

if (voiceSessionId !== undefined) {
  // Acknowledge the voice session
  socket.write(createRemoteVoiceBegin(voiceSessionId));
  console.log(`  📤 createRemoteVoiceBegin(${voiceSessionId}) sent`);

  // Send 1 second of silence (8kHz mono 16-bit = 8000 samples/s × 2 bytes)
  process.stdout.write('  🔊 Sending 1s silence PCM (5 × 200ms chunks) ... ');
  const CHUNK_SIZE = 1600; // 200ms at 8kHz mono 16-bit
  const silence = Buffer.alloc(CHUNK_SIZE * 2, 0);
  for (let i = 0; i < 5; i++) {
    socket.write(createRemoteVoicePayload(voiceSessionId, silence));
    await sleep(200);
  }
  console.log('✅ sent');
  passed++;

  // End the voice session
  await sleep(300);
  socket.write(createRemoteVoiceEnd(voiceSessionId));
  socket.write(createRemoteKeyInjectRaw('KEYCODE_SEARCH', 'END_LONG'));
  console.log('  📤 Voice session ended + END_LONG sent');
  await sleep(500);
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ${passed} passed  ${failed} failed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

socket.destroy();
process.exit(failed > 0 ? 1 : 0);
