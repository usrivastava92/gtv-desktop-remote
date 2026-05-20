#!/usr/bin/env node
/**
 * Headless TV communication test script.
 *
 * Loads the paired device + certs from disk and runs a sequence of remote
 * commands, reconnecting per-command (matching the production app behaviour).
 * Reports every inbound message so you can verify the TV is responding.
 *
 * Usage:
 *   npm run build && node scripts/tv-test.mjs              # first paired device
 *   npm run build && node scripts/tv-test.mjs 192.168.1.9  # explicit host
 *
 * The TV closes the remote protocol connection after each key injection.
 * This script reconnects per-command — exactly how the production app works.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// ── Load compiled codecs ──────────────────────────────────────────────────────

const DIST = path.join(ROOT, 'dist-electron');
if (!fs.existsSync(DIST)) {
  console.error('\n❌ dist-electron/ not found. Run: npm run build');
  process.exit(1);
}

const {
  createRemoteKeyInject,
  createRemoteConfigure,
  createRemoteSetActive,
  createRemotePingResponse,
  parseRemoteMessage,
} = require(path.join(DIST, 'backend/protocol/androidtv/remote.js'));

const { parseFramedBuffer } = require(
  path.join(DIST, 'backend/transport/framing/frameParser.js')
);

const REMOTE_FEATURES = 1;

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
  console.error(`❌ No paired device found. Available: ${devices.map((d) => `${d.name} (${d.host})`).join(', ')}`);
  process.exit(1);
}

const certPath = path.join(CERTS_DIR, `${device.host}.cert.pem`);
const keyPath  = path.join(CERTS_DIR, `${device.host}.key.pem`);
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error(`❌ Cert files not found for ${device.host} — try resetting + re-pairing.`);
  process.exit(1);
}

const cert = fs.readFileSync(certPath, 'utf8');
const key  = fs.readFileSync(keyPath, 'utf8');

console.log(`\n📺 ${device.name}  (${device.host})`);
console.log(`🔐 ${certPath}\n`);

// ── One-shot command sender ───────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open a fresh TLS connection, complete the remoteConfigure handshake, send
 * one command frame, wait for the TV's acknowledgement, then disconnect.
 * Returns an array of decoded inbound messages for logging.
 */
function sendOneCommand(label, frame, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const inbound = [];
    let buffer = Buffer.alloc(0);
    let handshakeDone = false;
    let commandSent = false;
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(inbound);
    };

    const timer = setTimeout(
      () => finish(new Error(`Timeout (${label}) — TV did not complete handshake in ${timeoutMs}ms`)),
      timeoutMs
    );

    const socket = tls.connect({
      host: device.host,
      port: 6466,
      cert,
      key,
      rejectUnauthorized: false,
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { frames, remaining, error } = parseFramedBuffer(buffer);
      buffer = Buffer.from(remaining);

      if (error) { finish(new Error(`Frame parse error: ${error.message}`)); return; }

      for (const f of frames) {
        let msg;
        try { msg = parseRemoteMessage(f); }
        catch (e) {
          inbound.push({ type: 'parseError', hex: f.toString('hex').slice(0, 32), err: e.message });
          continue;
        }

        if (msg.remoteConfigure) {
          const info = msg.remoteConfigure.deviceInfo ?? {};
          inbound.push({ type: 'remoteConfigure', model: info.model, vendor: info.vendor, appVersion: info.appVersion });
          socket.write(createRemoteConfigure(REMOTE_FEATURES));
          handshakeDone = true;
          // Send the command immediately after configure reply
          socket.write(frame);
          commandSent = true;
          continue;
        }

        if (msg.remotePingRequest?.val1 !== undefined) {
          socket.write(createRemotePingResponse(msg.remotePingRequest.val1));
          inbound.push({ type: 'ping', val1: msg.remotePingRequest.val1 });
          continue;
        }

        if (msg.remoteSetActive) {
          socket.write(createRemoteSetActive(REMOTE_FEATURES));
          inbound.push({ type: 'remoteSetActive' });
          // Ack received after command → done
          if (commandSent) { setTimeout(() => finish(null), 150); }
          continue;
        }

        if (msg.remoteImeKeyInject) {
          const app = msg.remoteImeKeyInject.appInfo?.appPackage;
          inbound.push({ type: 'remoteImeKeyInject', app });
          finish(null);
          continue;
        }

        if (msg.remoteStart) {
          inbound.push({ type: 'remoteStart', started: msg.remoteStart.started });
          continue;
        }

        inbound.push({ type: 'unknown', hex: f.toString('hex').slice(0, 32) });
      }
    });

    socket.on('close', () => finish(null));
    socket.on('error', (e) => finish(e));
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish(new Error(`Socket timeout (${label})`)));
  });
}

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

console.log(`🚀 Running ${COMMANDS.length} commands (reconnect per command)\n`);

let passed = 0;
let failed = 0;

for (const { command, label, delayAfterMs } of COMMANDS) {
  const frame = createRemoteKeyInject(command);
  process.stdout.write(`  ${label} ... `);

  try {
    const msgs = await sendOneCommand(label, frame);
    const appPkg = msgs.find((m) => m.type === 'remoteImeKeyInject')?.app;
    const acked  = msgs.some((m) => ['remoteImeKeyInject','remoteSetActive'].includes(m.type));
    const detail = appPkg ? ` app: ${appPkg}` : ` ${msgs.map((m) => m.type).join(', ')}`;
    console.log(acked ? `✅${detail}` : `⚠️  sent, no ack —${detail}`);
    passed++;
  } catch (err) {
    console.log(`❌  ${err.message}`);
    failed++;
  }

  await sleep(delayAfterMs);
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ${passed} passed  ${failed} failed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

process.exit(failed > 0 ? 1 : 0);
