import { describe, expect, it } from 'vitest';

import { decodeDnsSdValue, parseDnsSdTxtLine } from '../dnsSdText';

const NBSP = '\u00a0';

describe('decodeDnsSdValue', () => {
  it('decodes escaped quotes, spaces, and backslashes', () => {
    expect(decodeDnsSdValue('55\\"\\ Neo\\ QLED')).toBe('55" Neo QLED');
    expect(decodeDnsSdValue('a\\\\b')).toBe('a\\b');
  });

  it('decodes decimal \\DDD escapes', () => {
    expect(decodeDnsSdValue('Neo\\032QLED')).toBe('Neo QLED');
    expect(decodeDnsSdValue('tab\\009end')).toBe('tab\tend');
  });

  it('leaves unescaped text untouched', () => {
    expect(decodeDnsSdValue('QN80D')).toBe('QN80D');
  });
});

describe('parseDnsSdTxtLine', () => {
  // Captured verbatim from `dns-sd -L` output of real TVs.
  const samsungLine =
    ' id=300401e0c8d6e744e5e01c8a7a407fe4 fn=55\\"\\ Neo\\ QLED md=QN80D ic=/setup/icon.png ve=05 st=3';

  it('unescapes quotes inside values', () => {
    const txt = parseDnsSdTxtLine(samsungLine);
    expect(txt.fn).toBe('55" Neo QLED');
    expect(txt.md).toBe('QN80D');
    expect(txt.ic).toBe('/setup/icon.png');
  });

  it('keeps values with raw unescaped whitespace intact', () => {
    // dns-sd publishes the no-break space (U+00A0) raw, not escaped.
    const txt = parseDnsSdTxtLine(` fn=Televize\\ v${NBSP}obýváku md=Smart\\ TV\\ Pro st=0`);
    expect(txt.fn).toBe(`Televize v${NBSP}obýváku`);
    expect(txt.md).toBe('Smart TV Pro');
    expect(txt.st).toBe('0');
  });

  it('does not split values on an escaped space before a key-like token', () => {
    expect(parseDnsSdTxtLine(' fn=abc\\ md=X st=0')).toEqual({ fn: 'abc md=X', st: '0' });
  });

  it('ignores lines without valid key=value tokens', () => {
    expect(parseDnsSdTxtLine('   ')).toEqual({});
    expect(parseDnsSdTxtLine('DATE: ---Sun 16 Aug 2026---')).toEqual({});
  });
});
