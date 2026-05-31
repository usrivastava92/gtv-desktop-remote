import { describe, expect, it } from 'vitest';

import { __TEST__, parseFramedBuffer } from '../frameParser';

/**
 * Build a varint-length-prefixed frame whose body is `body`. This matches the
 * framing used by the Google TV remote service on the wire; the parser must
 * round-trip these byte-for-byte regardless of which upstream library
 * produces the protobuf payload.
 */
function frame(body: Buffer): Buffer {
  const header = encodeVarint(body.length);
  return Buffer.concat([header, body]);
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining & 0x7f);
  return Buffer.from(bytes);
}

function expectBuffer(actual: Buffer | undefined, expected: Buffer): void {
  expect(actual).toBeDefined();
  if (!actual) return;
  expect(Buffer.compare(actual, expected)).toBe(0);
}

describe('parseFramedBuffer — empty / trivial cases', () => {
  it('empty buffer → no frames, empty remaining', () => {
    const result = parseFramedBuffer(Buffer.alloc(0));
    expect(result.frames).toEqual([]);
    expect(result.remaining.length).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('single complete short frame (body 1 byte)', () => {
    const f = frame(Buffer.from([0x42]));
    const result = parseFramedBuffer(f);
    expect(result.frames).toHaveLength(1);
    expectBuffer(result.frames[0], f);
    expect(result.remaining.length).toBe(0);
  });

  it('single complete medium frame (body 100 bytes — single-byte varint)', () => {
    const body = Buffer.alloc(100, 0xab);
    const f = frame(body);
    const result = parseFramedBuffer(f);
    expect(result.frames).toHaveLength(1);
    expectBuffer(result.frames[0], f);
    expect(result.remaining.length).toBe(0);
  });

  it('single complete large frame (body 200 bytes — two-byte varint)', () => {
    const body = Buffer.alloc(200, 0x55);
    const f = frame(body);
    const firstByte = f[0];
    expect(firstByte).toBeDefined();
    if (firstByte !== undefined) {
      expect(firstByte & 0x80).toBe(0x80);
    }
    const result = parseFramedBuffer(f);
    expect(result.frames).toHaveLength(1);
    expectBuffer(result.frames[0], f);
    expect(result.remaining.length).toBe(0);
  });
});

describe('parseFramedBuffer — multi-frame buffers', () => {
  it('two back-to-back frames decode independently', () => {
    const a = frame(Buffer.from([0x01, 0x02]));
    const b = frame(Buffer.from([0x03, 0x04, 0x05]));
    const result = parseFramedBuffer(Buffer.concat([a, b]));
    expect(result.frames).toHaveLength(2);
    expectBuffer(result.frames[0], a);
    expectBuffer(result.frames[1], b);
    expect(result.remaining.length).toBe(0);
  });

  it('many frames in a single buffer', () => {
    const fs = Array.from({ length: 20 }, (_, i) =>
      frame(Buffer.from([i & 0xff, (i + 1) & 0xff, (i + 2) & 0xff]))
    );
    const result = parseFramedBuffer(Buffer.concat(fs));
    expect(result.frames).toHaveLength(20);
    for (let i = 0; i < 20; i += 1) {
      expectBuffer(result.frames[i], fs[i] ?? Buffer.alloc(0));
    }
  });
});

describe('parseFramedBuffer — partial reads (the realistic case)', () => {
  it('header complete but body partial → 0 frames + full buffer remaining', () => {
    const body = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    const f = frame(body); // [0x04, 0x10, 0x20, 0x30, 0x40]
    const partial = f.subarray(0, 3); // header + first 2 body bytes
    const result = parseFramedBuffer(partial);
    expect(result.frames).toEqual([]);
    expect(Buffer.compare(result.remaining, partial)).toBe(0);
  });

  it('only header byte received → 0 frames + that byte remains', () => {
    const f = frame(Buffer.alloc(100));
    const partial = f.subarray(0, 1);
    const result = parseFramedBuffer(partial);
    expect(result.frames).toEqual([]);
    expect(Buffer.compare(result.remaining, partial)).toBe(0);
  });

  it('multi-byte varint header arrives split across reads', () => {
    const body = Buffer.alloc(300, 0xee);
    const f = frame(body); // 2-byte header
    const partial = f.subarray(0, 1);
    const firstByte = partial[0];
    expect(firstByte).toBeDefined();
    if (firstByte !== undefined) {
      expect(firstByte & 0x80).toBe(0x80);
    }
    const result = parseFramedBuffer(partial);
    expect(result.frames).toEqual([]);
    expect(Buffer.compare(result.remaining, partial)).toBe(0);
  });

  it('one complete frame followed by a partial frame', () => {
    const a = frame(Buffer.from([0xaa, 0xbb]));
    const b = frame(Buffer.from([0xcc, 0xdd, 0xee, 0xff]));
    const partial = Buffer.concat([a, b.subarray(0, 3)]);
    const result = parseFramedBuffer(partial);
    expect(result.frames).toHaveLength(1);
    expectBuffer(result.frames[0], a);
    expect(Buffer.compare(result.remaining, b.subarray(0, 3))).toBe(0);
  });
});

describe('parseFramedBuffer — malformed input', () => {
  it('varint with too many continuation bits → error + remaining cleared', () => {
    const evil = Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
    const result = parseFramedBuffer(evil);
    expect(result.frames).toEqual([]);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe(__TEST__.MALFORMED_FRAME_ERROR_MESSAGE);
    expect(result.remaining.length).toBe(0);
  });

  it('any already-decoded frames before the malformed varint are still returned', () => {
    const a = frame(Buffer.from([0x01]));
    const evil = Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
    const result = parseFramedBuffer(Buffer.concat([a, evil]));
    expect(result.frames).toHaveLength(1);
    expectBuffer(result.frames[0], a);
    expect(result.error).toBeDefined();
    expect(result.remaining.length).toBe(0);
  });
});

describe('parseFramedBuffer — purity / determinism', () => {
  it('does not mutate the input buffer', () => {
    const a = frame(Buffer.from([0x10, 0x20]));
    const b = frame(Buffer.from([0x30, 0x40, 0x50]));
    const input = Buffer.concat([a, b]);
    const snapshot = Buffer.from(input);
    parseFramedBuffer(input);
    expect(Buffer.compare(input, snapshot)).toBe(0);
  });

  it('repeated calls on the same buffer return the same frames (byte-equal)', () => {
    const input = Buffer.concat([
      frame(Buffer.from([1])),
      frame(Buffer.from([2, 3])),
      frame(Buffer.from([4, 5, 6])),
    ]);
    const first = parseFramedBuffer(input);
    const second = parseFramedBuffer(input);
    expect(second.frames).toHaveLength(first.frames.length);
    for (let i = 0; i < first.frames.length; i += 1) {
      expectBuffer(second.frames[i], first.frames[i] ?? Buffer.alloc(0));
    }
  });
});

describe('parseFramedBuffer — caller usage simulation', () => {
  it('streaming reads of arbitrary chunk sizes recover all frames', () => {
    const frames = [
      frame(Buffer.from([0x01, 0x02])),
      frame(Buffer.alloc(100, 0xaa)),
      frame(Buffer.alloc(180, 0xbb)),
      frame(Buffer.from([0x99])),
    ];
    const stream = Buffer.concat(frames);

    let buffer = Buffer.alloc(0);
    const recovered: Buffer[] = [];
    for (let i = 0; i < stream.length; i += 7) {
      const chunk = stream.subarray(i, Math.min(i + 7, stream.length));
      buffer = Buffer.concat([buffer, chunk]);
      const result = parseFramedBuffer(buffer);
      recovered.push(...result.frames);
      buffer = Buffer.from(result.remaining);
    }
    expect(buffer.length).toBe(0);
    expect(recovered).toHaveLength(frames.length);
    for (let i = 0; i < frames.length; i += 1) {
      expectBuffer(recovered[i], frames[i] ?? Buffer.alloc(0));
    }
  });
});
