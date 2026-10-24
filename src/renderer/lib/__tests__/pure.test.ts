/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import {
  classes,
  isEditableTarget,
  isPairCodeComplete,
  sanitizePairCode,
  shouldRestartPairingFlow,
  supportsAssistantVoice,
  supportsCommand,
} from '../pure';

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

  it('strips non-hex letters (the code alphabet is 0-9 and A-F)', () => {
    expect(sanitizePairCode('AD0BDB')).toBe('AD0BDB');
    expect(sanitizePairCode('ADOBDB')).toBe('ADBDB'); // 'O' is not hex
    expect(sanitizePairCode('GHIJKL')).toBe('');
  });

  it('accepts a four-digit provider PIN without hex letters or excess digits', () => {
    const step = { instructions: 'Enter PIN', codeLength: 4, inputPattern: '[0-9]' };
    expect(sanitizePairCode('a0 1-23b4', step)).toBe('0123');
    expect(isPairCodeComplete('0123', step)).toBe(true);
    expect(isPairCodeComplete('012', step)).toBe(false);
    expect(isPairCodeComplete('01234', step)).toBe(false);
    expect(isPairCodeComplete('ABCD', step)).toBe(false);
  });

  it('uses the next provider alphabet and length rather than a six-slot assumption', () => {
    const step = { instructions: 'Enter code', codeLength: 8, inputPattern: '[A-Z0-9]' };
    expect(sanitizePairCode('gh-12-ij-34-zz', step)).toBe('GH12IJ34');
    expect(isPairCodeComplete('GH12IJ34', step)).toBe(true);
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
    'DecodeError: pairing code failed local certificate hash validation',
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

describe('supportsCommand', () => {
  it('keeps legacy command support but respects powerToggle', () => {
    expect(supportsCommand({ textInput: false, powerToggle: false }, 'home')).toBe(true);
    expect(supportsCommand({ textInput: false, powerToggle: false }, 'power')).toBe(false);
  });

  it('blocks unsupported media and assistant commands for every dispatch source', () => {
    const fire = {
      textInput: true,
      powerToggle: false,
      assistantVoice: false,
      supportedCommands: ['up', 'home'] as const,
    };
    const capabilities = { ...fire, supportedCommands: [...fire.supportedCommands] };
    expect(supportsCommand(capabilities, 'home')).toBe(true);
    expect(supportsCommand(capabilities, 'volume_up')).toBe(false);
    expect(supportsCommand(capabilities, 'assistant_press')).toBe(false);
    expect(supportsCommand({ ...capabilities, supportedCommands: [] }, 'home')).toBe(false);
  });

  it('blocks Fire microphone shortcuts without breaking omitted legacy voice capabilities', () => {
    expect(
      supportsAssistantVoice({
        textInput: true,
        powerToggle: false,
        assistantVoice: false,
      })
    ).toBe(false);
    expect(supportsAssistantVoice({ textInput: true, powerToggle: true })).toBe(true);
  });
});
