/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { classes, isEditableTarget, sanitizePairCode, shouldRestartPairingFlow } from '../pure';

describe('isEditableTarget (jsdom)', () => {
  it('returns false for null', () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  it('returns false for non-HTMLElement targets (e.g. window)', () => {
    expect(isEditableTarget(window)).toBe(false);
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])(
    'returns true for <%s> (typing surface, suppresses remote shortcuts)',
    (tag) => {
      const el = document.createElement(tag.toLowerCase());
      expect(isEditableTarget(el)).toBe(true);
    }
  );

  it('returns true for a contenteditable host', () => {
    // jsdom's contenteditable attribute -> isContentEditable getter mapping
    // is incomplete, so override the getter directly. This matches what
    // the production check actually relies on at runtime in Electron's
    // chromium renderer (where the spec'd boolean getter does work).
    const el = document.createElement('div');
    Object.defineProperty(el, 'isContentEditable', { value: true, configurable: true });
    expect(isEditableTarget(el)).toBe(true);
  });

  it('returns false for a plain <div>', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
  });

  it('returns false for a <button>', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
  });
});

describe('sanitizePairCode', () => {
  it('uppercases lowercase letters', () => {
    expect(sanitizePairCode('abc123')).toBe('ABC123');
  });

  it('strips punctuation, whitespace, symbols', () => {
    expect(sanitizePairCode('a-b c.d?e!f')).toBe('ABCDEF');
  });

  it('truncates to 6 characters (protocol limit)', () => {
    expect(sanitizePairCode('abcdefghij')).toBe('ABCDEF');
  });

  it('preserves digits and mixed alphanumerics', () => {
    expect(sanitizePairCode('1a2b3c4d')).toBe('1A2B3C');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizePairCode('')).toBe('');
  });

  it('returns empty string when all chars are stripped', () => {
    expect(sanitizePairCode('---!!!')).toBe('');
  });
});

describe('classes', () => {
  it('joins truthy strings with a single space', () => {
    expect(classes('a', 'b', 'c')).toBe('a b c');
  });

  it('drops false / null / undefined / empty string entries', () => {
    expect(classes('a', false, 'b', null, undefined, '', 'c')).toBe('a b c');
  });

  it('returns empty string when everything is falsy', () => {
    expect(classes(false, null, undefined, '')).toBe('');
  });

  it('handles the common conditional toggle pattern', () => {
    // Use Math.random-derived values so TS const-narrowing can't fold the
    // && expressions into trivially-true/trivially-false (which lint
    // would then flag as @typescript-eslint/no-unnecessary-condition).
    // The if/else just makes the truth values dynamic from TS's POV.
    const active = Date.now() > 0; // always true at runtime
    const disabled = Date.now() < 0; // always false at runtime
    expect(classes('btn', active && 'btn-active', disabled && 'btn-disabled')).toBe(
      'btn btn-active'
    );
  });
});

describe('shouldRestartPairingFlow', () => {
  it.each([
    'Invalid pairing code',
    'invalid pairing code',
    'Please request a new code',
    'No pairing session is active',
    'Pairing failed',
    'PAIRING FAILED', // case-insensitive
    'Server says: invalid pairing code, retry.',
  ])('matches: %s', (msg) => {
    expect(shouldRestartPairingFlow(msg)).toBe(true);
  });

  it.each(['', 'Connection timed out', 'Network unreachable', 'TLS handshake error'])(
    'does not match: %s',
    (msg) => {
      expect(shouldRestartPairingFlow(msg)).toBe(false);
    }
  );
});
