import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_VOICE_SAMPLE_RATE,
  convertFloat32ToPcm16,
  downsampleTo8kMono,
  toBase64,
} from '../audio';

describe('ASSISTANT_VOICE_SAMPLE_RATE', () => {
  it('is locked at 8000 (Google TV voice channel contract)', () => {
    expect(ASSISTANT_VOICE_SAMPLE_RATE).toBe(8_000);
  });
});

describe('convertFloat32ToPcm16', () => {
  it('returns an Int16Array of the same length', () => {
    const out = convertFloat32ToPcm16(new Float32Array(5));
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(5);
  });

  it('encodes 0 as 0', () => {
    const out = convertFloat32ToPcm16(new Float32Array([0]));
    expect(out[0]).toBe(0);
  });

  it('encodes +1 as 0x7fff (positive full-scale)', () => {
    const out = convertFloat32ToPcm16(new Float32Array([1]));
    expect(out[0]).toBe(0x7fff);
  });

  it('encodes -1 as -0x8000 (negative full-scale)', () => {
    const out = convertFloat32ToPcm16(new Float32Array([-1]));
    expect(out[0]).toBe(-0x8000);
  });

  it('clamps samples above +1 to +0x7fff', () => {
    const out = convertFloat32ToPcm16(new Float32Array([2.5]));
    expect(out[0]).toBe(0x7fff);
  });

  it('clamps samples below -1 to -0x8000', () => {
    const out = convertFloat32ToPcm16(new Float32Array([-2.5]));
    expect(out[0]).toBe(-0x8000);
  });

  it('rounds 0.5 to 16383 (0.5 * 32767 = 16383.5 → 16384 via Math.round)', () => {
    const out = convertFloat32ToPcm16(new Float32Array([0.5]));
    expect(out[0]).toBe(16_384);
  });

  it('rounds -0.5 to -16384 (-0.5 * 32768 = -16384 exactly)', () => {
    const out = convertFloat32ToPcm16(new Float32Array([-0.5]));
    expect(out[0]).toBe(-16_384);
  });

  it('encodes the empty array to an empty Int16Array', () => {
    expect(convertFloat32ToPcm16(new Float32Array()).length).toBe(0);
  });
});

describe('downsampleTo8kMono', () => {
  it('passes through when the source is already at 8 kHz', () => {
    const source = new Float32Array([1, 0, -1, 0.5]);
    const bytes = downsampleTo8kMono(source, 8_000);
    const view = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    expect(Array.from(view)).toEqual([0x7fff, 0, -0x8000, 16_384]);
  });

  it('passes through when the source is below 8 kHz (no upsampling)', () => {
    const source = new Float32Array([1, -1]);
    const bytes = downsampleTo8kMono(source, 4_000);
    const view = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    expect(view.length).toBe(2);
  });

  it('downsamples 48 kHz to 8 kHz at the expected length ratio', () => {
    // 48 kHz / 8 kHz = ratio 6. Source length 60 → expected output length 10.
    const source = new Float32Array(60);
    for (let i = 0; i < 60; i += 1) source[i] = 0.5;
    const bytes = downsampleTo8kMono(source, 48_000);
    expect(bytes.byteLength).toBe(10 * 2); // 10 int16 samples
  });

  it('averages source samples within each output window', () => {
    const source = new Float32Array([1, -1, 1, -1, 1, -1, 1, -1]);
    const bytes = downsampleTo8kMono(source, 16_000);
    const view = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    expect(view.length).toBe(4);
    for (const s of view) expect(s).toBe(0);
  });

  it('preserves a constant-amplitude signal across downsample', () => {
    // All +0.5 samples should round-trip to ~16384 regardless of rate.
    const source = new Float32Array(48);
    source.fill(0.5);
    const bytes = downsampleTo8kMono(source, 48_000);
    const view = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    for (const s of view) expect(s).toBe(16_384);
  });

  it('returns at least one sample for tiny inputs (Math.max(1, ...) floor)', () => {
    const source = new Float32Array([0.5]);
    const bytes = downsampleTo8kMono(source, 48_000);
    expect(bytes.byteLength).toBeGreaterThanOrEqual(2);
  });
});

describe('toBase64', () => {
  it('encodes the empty buffer to the empty string', () => {
    expect(toBase64(new Uint8Array())).toBe('');
  });

  it('encodes ASCII "Hello" correctly', () => {
    expect(toBase64(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]))).toBe('SGVsbG8=');
  });

  it('encodes a single zero byte to "AA=="', () => {
    expect(toBase64(new Uint8Array([0]))).toBe('AA==');
  });

  it('encodes the byte 0xff as "/w=="', () => {
    expect(toBase64(new Uint8Array([0xff]))).toBe('/w==');
  });

  it('round-trips through atob', () => {
    const original = new Uint8Array([0, 1, 2, 254, 255]);
    const decoded = atob(toBase64(original));
    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i += 1) {
      expect(decoded.charCodeAt(i)).toBe(original[i]);
    }
  });
});
