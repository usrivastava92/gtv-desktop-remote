/**
 * Structured capture logger for end-to-end fixture extraction.
 *
 * Active ONLY when the `GTV_CAPTURE=1` environment variable is set.
 * Zero performance cost in production (all methods are no-ops when disabled).
 *
 * Output: newline-delimited JSON (ndjson) written to `captures/capture-<date>.ndjson`
 * in the repo root. Each record contains:
 *   - ts:        ISO-8601 timestamp
 *   - seq:       monotonic sequence number (for ordering within a session)
 *   - layer:     ipc | pairing | remote | transport | voice | discovery
 *   - direction: tx (sent to TV) | rx (received from TV) | call (renderer→main) | return (main→renderer)
 *   - event:     human-readable event name
 *   - hex:       raw bytes as hex string (for binary frames)
 *   - data:      decoded JSON payload (for structured messages)
 *   - meta:      any extra context (sessionId, deviceId, channel, etc.)
 *   - durationMs: for call/return pairs, how long the handler took
 *   - error:     error message if the operation failed
 */

import type { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';

export type CaptureLayer = 'ipc' | 'pairing' | 'remote' | 'transport' | 'voice' | 'discovery';
export type CaptureDirection = 'tx' | 'rx' | 'call' | 'return';

export interface CaptureRecord {
  ts: string;
  seq: number;
  layer: CaptureLayer;
  direction: CaptureDirection;
  event: string;
  hex?: string;
  data?: unknown;
  meta?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

let enabled = false;
let captureStream: fs.WriteStream | null = null;
let seq = 0;
let captureFilePath = '';

/**
 * Call once at app startup (before any IPC handlers are registered).
 * If GTV_CAPTURE=1 is not set this is a no-op.
 */
export function initCapture(repoRoot: string): void {
  if (process.env.GTV_CAPTURE !== '1') return;

  enabled = true;
  seq = 0;

  const capturesDir = path.join(repoRoot, 'captures');
  fs.mkdirSync(capturesDir, { recursive: true });

  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  captureFilePath = path.join(capturesDir, `capture-${date}.ndjson`);

  captureStream = fs.createWriteStream(captureFilePath, { flags: 'w', encoding: 'utf8' });

  record({
    layer: 'ipc',
    direction: 'call',
    event: 'capture-session-start',
    data: { captureFile: captureFilePath, pid: process.pid },
  });

  console.log(`[capture] GTV_CAPTURE=1 — writing to ${captureFilePath}`);
}

/** Flush and close the capture file. Call at app quit. */
export function closeCapture(): void {
  if (!enabled || !captureStream) return;
  record({ layer: 'ipc', direction: 'return', event: 'capture-session-end' });
  captureStream.end();
  captureStream = null;
}

/** Returns true if capture is active. */
export function isCaptureEnabled(): boolean {
  return enabled;
}

/** Returns the path to the current capture file (empty string if not capturing). */
export function getCaptureFilePath(): string {
  return captureFilePath;
}

interface RecordInput {
  layer: CaptureLayer;
  direction: CaptureDirection;
  event: string;
  hex?: string;
  data?: unknown;
  meta?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

/** Write a single capture record. No-op if capture is not enabled. */
export function record(input: RecordInput): void {
  if (!enabled || !captureStream) return;
  const entry: CaptureRecord = {
    ts: new Date().toISOString(),
    seq: seq++,
    ...input,
  };
  captureStream.write(JSON.stringify(entry) + '\n');
}

/**
 * Convenience: record a Buffer as both hex and its decoded JSON (if parseable).
 * Used for protobuf frames where we want byte-exact replay AND human readability.
 */
export function recordBuffer(
  layer: CaptureLayer,
  direction: CaptureDirection,
  event: string,
  buf: Buffer,
  meta?: Record<string, unknown>
): void {
  if (!enabled) return;
  record({
    layer,
    direction,
    event,
    hex: buf.toString('hex'),
    meta,
  });
}

/**
 * Wrap an async IPC handler to capture call + return (with duration + error).
 * Usage: ipcMain.handle(channel, captureIpc(channel, originalHandler))
 *
 * The handler's parameter types are erased to `unknown[]` at the wrapper
 * boundary (matching Electron's ipcMain.handle signature) while preserving
 * the return type T.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function captureIpc<T>(
  channel: string,
  handler: (...args: any[]) => Promise<T> | T
): (...args: unknown[]) => Promise<T> {
  if (!enabled) return handler as (...args: unknown[]) => Promise<T>;
  return async (...args: unknown[]): Promise<T> => {
    const start = Date.now();
    record({
      layer: 'ipc',
      direction: 'call',
      event: `ipc:${channel}`,
      data: args.length > 0 ? args : undefined,
      meta: { channel },
    });
    try {
      const result = await (handler as (...args: unknown[]) => Promise<T>)(...args);
      record({
        layer: 'ipc',
        direction: 'return',
        event: `ipc:${channel}:ok`,
        data: result,
        meta: { channel },
        durationMs: Date.now() - start,
      });
      return result;
    } catch (err) {
      record({
        layer: 'ipc',
        direction: 'return',
        event: `ipc:${channel}:error`,
        meta: { channel },
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
