/**
 * Reverses `dns-sd` ShowTXTRecord's shell-friendly presentation of TXT values.
 * Literal backslashes print as four backslashes, control bytes as two
 * backslashes followed by xHH, and shell metacharacters as backslash + character.
 * Decode once so literal backslashes cannot turn into a second escape.
 * Browse callback instance names are already raw UTF-8 and must not use this.
 */
export function decodeDnsSdValue(value: string): string {
  return value.replace(
    /\\{4}|\\{2}x([0-9A-Fa-f]{2})|\\([ &;`'"|*?~<>^()[\]{}$])/g,
    (_, hex: string | undefined, character: string | undefined) =>
      hex !== undefined ? String.fromCharCode(parseInt(hex, 16)) : (character ?? '\\')
  );
}
