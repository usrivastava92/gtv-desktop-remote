/**
 * Pure parser for varint-length-prefixed frames over the Android TV remote
 * protocol. Extracted from the inline `readNextFrame` + `flushBuffer`
 * loop in `src/main/device/androidTvRemote.ts` so it is:
 *
 *   - unit-testable byte-by-byte without standing up a TLS socket;
 *   - reusable by any future transport (recorded captures, fake socket
 *     in tests, eventual replacement of androidtv-remote with a homegrown
 *     transport).
 *
 * Wire format (matches the on-the-wire format used by Google's Android TV
 * v2 remote service on port 6466):
 *
 *   ┌─────────────┬──────────────────────────────┐
 *   │ varint len  │ protobuf body (`len` bytes)  │
 *   └─────────────┴──────────────────────────────┘
 *
 * The varint is little-endian, 7 bits per byte, high bit set to indicate
 * "more bytes follow". The protocol only uses 32-bit varints (max 5 bytes),
 * so we cap `shift` at 28 to catch malformed input.
 *
 * Behavior parity with the previous inline parser is asserted by tests in
 * `__tests__/frameParser.test.ts`.
 */
export interface FrameParseResult {
  /** Frames fully assembled from `buffer`. Each is the WHOLE frame including
   * its varint header (this matches what the previous inline parser
   * returned to callers). */
  readonly frames: readonly Buffer[];
  /** The trailing bytes that did not form a complete frame yet. Must be
   * prepended to the next chunk received from the socket. */
  readonly remaining: Buffer;
  /** Set iff the parser detected a malformed varint header (too many
   * continuation bits). Caller MUST drop the connection — the stream is
   * unrecoverable. The parser also clears `remaining` to empty in this case. */
  readonly error?: Error;
}

/** Maximum number of bits in a 32-bit varint header (5 * 7 = 35; we cap at 28
 * because the 5th byte may only contribute 4 bits but the parser treats it
 * the same as the previous inline implementation: `shift > 28` → error). */
const MAX_VARINT_SHIFT_BITS = 28;

/** Sentinel for a malformed varint header. Matches the message the previous
 * inline parser used so error logs and pollinator tests are unchanged. */
const MALFORMED_FRAME_ERROR_MESSAGE = 'Received an invalid remote protocol frame.';

/**
 * Decode all complete frames sitting in `buffer`. Returns the assembled
 * frames + whatever bytes are left over (must be prepended to the next
 * read).
 *
 * Pure: never mutates `buffer`, never throws (errors are returned in
 * `result.error`), never allocates beyond what the returned `Buffer.subarray`
 * slices reference.
 */
export function parseFramedBuffer(buffer: Buffer): FrameParseResult {
  if (buffer.length === 0) {
    return { frames: [], remaining: buffer };
  }

  const frames: Buffer[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const headerEnd = decodeVarintHeader(buffer, cursor);
    if (headerEnd.kind === 'error') {
      return { frames, remaining: Buffer.alloc(0), error: headerEnd.error };
    }
    if (headerEnd.kind === 'need-more') {
      // Either incomplete varint OR complete varint but not enough body.
      break;
    }

    const frameLength = headerEnd.headerLength + headerEnd.bodyLength;
    if (buffer.length - cursor < frameLength) {
      // Header complete but body not fully received yet.
      break;
    }

    const frame = buffer.subarray(cursor, cursor + frameLength);
    frames.push(frame);
    cursor += frameLength;
  }

  const remaining = cursor === 0 ? buffer : buffer.subarray(cursor);
  return { frames, remaining };
}

type HeaderDecode =
  | { kind: 'ok'; headerLength: number; bodyLength: number }
  | { kind: 'need-more' }
  | { kind: 'error'; error: Error };

/**
 * Decode the varint header starting at `start`. Returns the header byte
 * length AND the protobuf body length (so the caller can immediately compute
 * the total frame length). Returns `need-more` if the varint is incomplete.
 */
function decodeVarintHeader(buffer: Buffer, start: number): HeaderDecode {
  let length = 0;
  let shift = 0;

  for (let index = start; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte === undefined) {
      // Defensive: should be unreachable because index < buffer.length.
      return { kind: 'need-more' };
    }
    length |= (byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      return { kind: 'ok', headerLength: index - start + 1, bodyLength: length };
    }

    shift += 7;
    if (shift > MAX_VARINT_SHIFT_BITS) {
      return { kind: 'error', error: new Error(MALFORMED_FRAME_ERROR_MESSAGE) };
    }
  }

  return { kind: 'need-more' };
}

export const __TEST__ = {
  MALFORMED_FRAME_ERROR_MESSAGE,
  MAX_VARINT_SHIFT_BITS,
};
