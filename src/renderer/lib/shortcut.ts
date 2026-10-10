export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function shortcutLabel(shortcut: string, mac = isMacPlatform()): string {
  const labels: Record<string, string> = {
    CommandOrControl: mac ? 'Cmd' : 'Ctrl',
    Command: mac ? 'Cmd' : 'Win',
    Super: mac ? 'Cmd' : 'Win',
    Control: 'Ctrl',
    Alt: mac ? 'Opt' : 'Alt',
    Shift: 'Shift',
  };
  return shortcut
    .split('+')
    .map((part) => labels[part] ?? part)
    .join('+');
}

type ShortcutKey = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'
> & {
  isComposing?: boolean;
};

export function shortcutModifiers(event: ShortcutKey): string[] {
  return [
    event.ctrlKey ? 'Control' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey ? 'Super' : null,
  ].filter((value): value is string => value !== null);
}

export function recordedShortcut(event: ShortcutKey, mac = isMacPlatform()): string | null {
  if (event.isComposing || ['Process', 'Unidentified'].includes(event.key)) return null;
  let key = event.key;
  if (!/^(?:[a-z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/i.test(key)) {
    // Shift changes digit glyphs; macOS Option can also transform letters/digits.
    if (
      (event.shiftKey && /^Digit[0-9]$/.test(event.code)) ||
      (mac && event.altKey && /^(?:Key[A-Z]|Digit[0-9])$/.test(event.code))
    ) {
      key = event.code.replace(/^(?:Key|Digit)/, '');
    } else {
      return null;
    }
  }
  const modifiers = shortcutModifiers(event);
  if (!modifiers.some((modifier) => modifier !== 'Shift')) return null;
  return [...modifiers, key.toUpperCase()].join('+');
}
