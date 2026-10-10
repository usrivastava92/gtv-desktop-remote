import { describe, expect, it } from 'vitest';

import { recordedShortcut, shortcutLabel } from '../shortcut';

const chord = {
  key: 'g',
  code: 'KeyG',
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
};

describe('recorded shortcut keys and platform labels', () => {
  it('keeps accelerators canonical while presenting platform-specific modifier names', () => {
    expect(recordedShortcut(chord, true)).toBe('Control+Alt+G');
    expect(shortcutLabel('Control+Alt+G', true)).toBe('Ctrl+Opt+G');
    expect(shortcutLabel('Control+Alt+G', false)).toBe('Ctrl+Alt+G');
    expect(shortcutLabel('Super+Shift+G', true)).toBe('Cmd+Shift+G');
    expect(shortcutLabel('Super+Shift+G', false)).toBe('Win+Shift+G');
    expect(shortcutLabel('CommandOrControl+Shift+G', true)).toBe('Cmd+Shift+G');
    expect(shortcutLabel('CommandOrControl+Shift+G', false)).toBe('Ctrl+Shift+G');
  });

  it('prefers usable layout keys and falls back only for Mac Option-transformed base keys', () => {
    expect(recordedShortcut({ ...chord, key: 'r', code: 'KeyG' }, true)).toBe('Control+Alt+R');
    expect(recordedShortcut({ ...chord, key: '©' }, true)).toBe('Control+Alt+G');
    expect(recordedShortcut({ ...chord, key: 'Dead', code: 'KeyE' }, true)).toBe('Control+Alt+E');
    expect(recordedShortcut({ ...chord, key: '©' }, false)).toBeNull();
    expect(recordedShortcut({ ...chord, key: '©', altKey: false }, true)).toBeNull();
    expect(recordedShortcut({ ...chord, key: 'Process' }, true)).toBeNull();
    expect(recordedShortcut({ ...chord, isComposing: true }, true)).toBeNull();
  });

  it.each([true, false])('records shifted digit glyphs on Mac=%s', (mac) => {
    expect(
      recordedShortcut({ ...chord, key: '!', code: 'Digit1', altKey: false, shiftKey: true }, mac)
    ).toBe('Control+Shift+1');
  });

  it('supports only backend-accepted base keys with a non-Shift modifier', () => {
    expect(recordedShortcut({ ...chord, key: 'F24', code: 'F24' }, false)).toBe('Control+Alt+F24');
    expect(recordedShortcut({ ...chord, key: '1', code: 'Digit1' }, false)).toBe('Control+Alt+1');
    expect(recordedShortcut({ ...chord, key: 'F25', code: 'F25' }, true)).toBeNull();
    expect(recordedShortcut({ ...chord, key: ' ', code: 'Space' }, true)).toBeNull();
    expect(
      recordedShortcut({ ...chord, ctrlKey: false, altKey: false, shiftKey: true }, true)
    ).toBeNull();
    expect(
      recordedShortcut({ ...chord, ctrlKey: false, altKey: false, metaKey: true }, false)
    ).toBe('Super+G');
  });
});
