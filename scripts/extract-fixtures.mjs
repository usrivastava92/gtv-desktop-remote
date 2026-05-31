#!/usr/bin/env node
/**
 * Fixture extractor — converts a captures/capture-*.ndjson session log into
 * golden fixture files under src/backend/**\/__fixtures__/.
 *
 * Usage:
 *   node scripts/extract-fixtures.mjs captures/capture-2026-05-20T...ndjson
 *   node scripts/extract-fixtures.mjs              # auto-picks the latest capture
 *
 * Output:
 *   src/backend/transport/framing/__fixtures__/inbound-frames.bin   (raw frames)
 *   src/backend/voice/__fixtures__/voice-session.json
 *   src/backend/__fixtures__/ipc-session.json
 *   src/backend/__fixtures__/discovery-session.json
 *
 * Each fixture file contains the minimal data needed to write or extend tests
 * without a real Google TV. Run this after GTV_CAPTURE=1 yarn dev.
 */

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAPTURES_DIR = path.join(ROOT, 'captures');
const FIXTURES_ROOT = path.join(ROOT, 'src', 'backend');

// ── resolve input file ────────────────────────────────────────────────────────

function findLatestCapture() {
  if (!fs.existsSync(CAPTURES_DIR)) {
    console.error('No captures/ directory found. Run GTV_CAPTURE=1 yarn dev first.');
    process.exit(1);
  }
  const files = fs
    .readdirSync(CAPTURES_DIR)
    .filter((f) => f.endsWith('.ndjson'))
    .sort()
    .reverse();
  if (!files.length) {
    console.error('No capture files found in captures/. Run GTV_CAPTURE=1 yarn dev first.');
    process.exit(1);
  }
  return path.join(CAPTURES_DIR, files[0]);
}

const inputFile = process.argv[2] ?? findLatestCapture();
console.log(`\n📂 Reading capture: ${inputFile}\n`);

// ── parse ndjson ──────────────────────────────────────────────────────────────

const records = fs
  .readFileSync(inputFile, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      console.warn(`  warn: skipping malformed line ${i + 1}`);
      return null;
    }
  })
  .filter(Boolean);

console.log(`  ${records.length} records loaded`);

// ── helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(
    `  ✅ wrote ${path.relative(ROOT, filePath)}  (${JSON.stringify(data).length} bytes)`
  );
}

function writeBin(filePath, hexString) {
  ensureDir(path.dirname(filePath));
  const buf = Buffer.from(hexString, 'hex');
  fs.writeFileSync(filePath, buf);
  console.log(`  ✅ wrote ${path.relative(ROOT, filePath)}  (${buf.length} bytes)`);
}

// ── extract by layer ──────────────────────────────────────────────────────────

// IPC session — all call/return pairs
const ipcRecords = records.filter(
  (r) =>
    r.layer === 'ipc' && r.event !== 'capture-session-start' && r.event !== 'capture-session-end'
);
const ipcPairs = [];
const callMap = new Map();
for (const r of ipcRecords) {
  if (r.direction === 'call') {
    callMap.set(r.meta?.channel, r);
  } else if (r.direction === 'return') {
    const call = callMap.get(r.meta?.channel);
    ipcPairs.push({
      channel: r.meta?.channel,
      args: call?.data,
      result: r.data,
      durationMs: r.durationMs,
      error: r.error,
    });
    callMap.delete(r.meta?.channel);
  }
}
if (ipcPairs.length) {
  writeJson(path.join(FIXTURES_ROOT, '__fixtures__', 'ipc-session.json'), {
    captureFile: inputFile,
    pairs: ipcPairs,
  });
}

// Transport — inbound raw frames (hex) concatenated into a single binary fixture
const inboundFrames = records.filter(
  (r) => r.layer === 'transport' && r.direction === 'rx' && r.hex
);
if (inboundFrames.length) {
  const frameMeta = inboundFrames.map((r) => ({
    seq: r.seq,
    ts: r.ts,
    hexLength: r.hex.length / 2,
  }));
  writeJson(
    path.join(FIXTURES_ROOT, 'transport', 'framing', '__fixtures__', 'inbound-frames-meta.json'),
    { captureFile: inputFile, frameCount: inboundFrames.length, frames: frameMeta }
  );
  // write each frame as a separate .bin file (for byte-exact parseFramedBuffer tests)
  const framesDir = path.join(FIXTURES_ROOT, 'transport', 'framing', '__fixtures__', 'frames');
  ensureDir(framesDir);
  inboundFrames.forEach((r, i) => {
    writeBin(path.join(framesDir, `frame-${String(i).padStart(4, '0')}.bin`), r.hex);
  });
}

// Voice — full voice session
const voiceRecords = records.filter((r) => r.layer === 'voice');
if (voiceRecords.length) {
  const voiceChunks = voiceRecords.filter((r) => r.event === 'voiceChunk');
  const voiceEvents = voiceRecords.filter((r) => r.event !== 'voiceChunk');
  writeJson(path.join(FIXTURES_ROOT, 'voice', '__fixtures__', 'voice-session.json'), {
    captureFile: inputFile,
    events: voiceEvents.map((r) => ({ seq: r.seq, ts: r.ts, event: r.event, meta: r.meta })),
    chunkCount: voiceChunks.length,
    totalBytes: voiceChunks.reduce((sum, r) => sum + (r.meta?.byteLength ?? 0), 0),
  });
  // write PCM chunks as a single concatenated binary for voice codec tests
  if (voiceChunks.length) {
    const chunksDir = path.join(FIXTURES_ROOT, 'voice', '__fixtures__');
    ensureDir(chunksDir);
    const allHex = voiceChunks.map((r) => r.hex ?? '').join('');
    writeBin(path.join(chunksDir, 'voice-chunks-concatenated.bin'), allHex);
  }
}

// Discovery
const discoveryRecords = records.filter((r) => r.layer === 'discovery');
if (discoveryRecords.length) {
  writeJson(path.join(FIXTURES_ROOT, 'discovery', '__fixtures__', 'discovery-session.json'), {
    captureFile: inputFile,
    events: discoveryRecords.map((r) => ({
      seq: r.seq,
      ts: r.ts,
      event: r.event,
      data: r.data,
      meta: r.meta,
    })),
  });
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`
✅ Extraction complete.

Fixture files are ready to use in tests. Next steps:
  1. Review the generated JSON/bin files in src/backend/**/__fixtures__/
  2. Add tests that load fixtures with:
       const frames = fs.readdirSync(__fixtures__('frames')).map(...)
       parseFramedBuffer(frame) // → match framing invariants
  3. Commit the fixture files alongside new test files.
  4. Run: yarn test
`);
