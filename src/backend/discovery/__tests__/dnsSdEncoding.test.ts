import { describe, expect, it } from 'vitest';

import { decodeDnsSdValue } from '../dnsSdEncoding';

describe('decodeDnsSdValue', () => {
  it('decodes shell-metacharacter escapes from dns-sd TXT values', () => {
    expect(decodeDnsSdValue(`Dan\\'s\\ Google\\ TV`)).toBe(`Dan's Google TV`);
    expect(decodeDnsSdValue(`\\[LG\\]\\ webOS\\ TV`)).toBe(`[LG] webOS TV`);
    expect(decodeDnsSdValue(`Daniel\\'s\\ Bedroom\\ Display`)).toBe(`Daniel's Bedroom Display`);
  });

  it('decodes escaped spaces and control-byte tokens as printed by dns-sd', () => {
    expect(decodeDnsSdValue(`Bathroom\\ speaker`)).toBe('Bathroom speaker');
    expect(decodeDnsSdValue(String.raw`x\\x09y`)).toBe('x\ty');
  });

  it('preserves literal backslash sequences without decoding them twice', () => {
    expect(decodeDnsSdValue(String.raw`a\\\\x09b`)).toBe(String.raw`a\x09b`);
    expect(decodeDnsSdValue(String.raw`a\\\\032b`)).toBe(String.raw`a\032b`);
    expect(decodeDnsSdValue(String.raw`a\\\\\'b`)).toBe(String.raw`a\'b`);
    expect(decodeDnsSdValue(String.raw`a\\\\\\\\b`)).toBe(String.raw`a\\b`);
  });

  it('leaves plain values unchanged', () => {
    expect(decodeDnsSdValue('Bedroom TV')).toBe('Bedroom TV');
    expect(decodeDnsSdValue(`TV and Speakers`)).toBe('TV and Speakers');
  });
});
