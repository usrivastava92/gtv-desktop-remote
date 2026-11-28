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

/**
 * Parse one TXT-record line of `dns-sd -L` output into key/value pairs.
 * Values may contain raw (unescaped) whitespace - real TVs publish names like
 * `fn=Televize\ v<NBSP>obývaku` - so entries are split only where a whitespace
 * run is followed by the next `key=` token.
 */
export function parseDnsSdTxtLine(line: string): Record<string, string> {
  const txt: Record<string, string> = {};

  for (const entry of line.trim().split(/(?<!\\)\s+(?=[A-Za-z0-9_-]+=)/)) {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = entry.slice(0, separator);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      continue;
    }

    txt[key] = decodeDnsSdValue(entry.slice(separator + 1));
  }

  return txt;
}
