/**
 * Helpers for parsing the text output of the macOS `dns-sd` tool.
 *
 * `dns-sd` prints mDNS data in DNS presentation format: ASCII specials are
 * backslash-escaped (`\ `, `\"`, `\\`), non-printable bytes appear as decimal
 * `\DDD`, and non-ASCII UTF-8 bytes — including U+00A0 no-break space — pass
 * through raw. TXT values can therefore contain unescaped whitespace, so a
 * value only ends where the next `key=` token begins.
 */

/** Decode dns-sd's DNS presentation escaping: decimal `\DDD` and `\X` → `X`. */
export function decodeDnsSdValue(value: string): string {
  return value.replace(/\\(\d{3}|.)/g, (_match, escaped: string) =>
    /^\d{3}$/.test(escaped) ? String.fromCharCode(Number(escaped)) : escaped
  );
}

/**
 * Parse one TXT-record line of `dns-sd -L` output into key/value pairs.
 * Values may contain raw (unescaped) whitespace — real TVs publish names like
 * `fn=Televize\ v<NBSP>obývaku` — so entries are split only where a whitespace
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
