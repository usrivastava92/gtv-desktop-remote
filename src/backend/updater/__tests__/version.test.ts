import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  findBestMacAsset,
  formatMinutesUntil,
  isDmgAsset,
  normalizeVersion,
} from '../version';

describe('normalizeVersion', () => {
  it('strips a leading lowercase v', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
  });

  it('strips a leading uppercase V', () => {
    expect(normalizeVersion('V0.8.0')).toBe('0.8.0');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeVersion('  v1.0.0\n')).toBe('1.0.0');
  });

  it('leaves a bare version untouched', () => {
    expect(normalizeVersion('1.0.0')).toBe('1.0.0');
  });

  it('only strips a single leading v, not embedded ones', () => {
    expect(normalizeVersion('v1.2v')).toBe('1.2v');
  });
});

describe('compareVersions', () => {
  it('returns 0 for identical versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns 0 for v-prefixed equality', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('treats missing trailing segments as 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.0.0')).toBe(0);
  });

  it('orders by patch correctly', () => {
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
  });

  it('orders by minor correctly', () => {
    expect(compareVersions('1.3.0', '1.2.99')).toBe(1);
  });

  it('orders by major correctly', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });

  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
  });

  it('treats non-numeric segments as 0', () => {
    expect(compareVersions('1.0.foo', '1.0.0')).toBe(0);
  });

  it('handles a longer version winning by extra non-zero segment', () => {
    expect(compareVersions('1.2.3.1', '1.2.3')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3.1')).toBe(-1);
  });
});

describe('formatMinutesUntil', () => {
  const NOW = 1_700_000_000;

  it('returns "shortly" when the epoch is in the past', () => {
    expect(formatMinutesUntil(NOW - 60, NOW)).toBe('shortly');
  });

  it('returns "shortly" when the epoch equals now', () => {
    expect(formatMinutesUntil(NOW, NOW)).toBe('shortly');
  });

  it('returns "shortly" for NaN', () => {
    expect(formatMinutesUntil(Number.NaN, NOW)).toBe('shortly');
  });

  it('returns "in about a minute" for ≤ 60s away', () => {
    expect(formatMinutesUntil(NOW + 30, NOW)).toBe('in about a minute');
    expect(formatMinutesUntil(NOW + 60, NOW)).toBe('in about a minute');
  });

  it('rounds up to the next minute for the 61–119s range', () => {
    expect(formatMinutesUntil(NOW + 61, NOW)).toBe('in about 2 minutes');
    expect(formatMinutesUntil(NOW + 119, NOW)).toBe('in about 2 minutes');
  });

  it('reports minutes for the < 60min range', () => {
    expect(formatMinutesUntil(NOW + 30 * 60, NOW)).toBe('in about 30 minutes');
    expect(formatMinutesUntil(NOW + 59 * 60, NOW)).toBe('in about 59 minutes');
  });

  it('uses the singular "hour" boundary', () => {
    expect(formatMinutesUntil(NOW + 60 * 60, NOW)).toBe('in about 1 hour');
  });

  it('uses the plural "hours" boundary', () => {
    expect(formatMinutesUntil(NOW + 2 * 60 * 60, NOW)).toBe('in about 2 hours');
  });

  it('defaults nowEpoch to Date.now() when omitted', () => {
    // We can't pin Date.now without mocks; just assert the result is one of the
    // valid shapes rather than a crash.
    const future = Math.floor(Date.now() / 1000) + 120;
    const result = formatMinutesUntil(future);
    expect(['in about a minute', 'in about 2 minutes']).toContain(result);
  });
});

describe('isDmgAsset', () => {
  it('returns true for .dmg', () => {
    expect(isDmgAsset({ name: 'foo-mac-arm64.dmg' })).toBe(true);
  });

  it('returns false for .zip', () => {
    expect(isDmgAsset({ name: 'foo-mac-arm64.zip' })).toBe(false);
  });

  it('is case-sensitive (matches release naming)', () => {
    expect(isDmgAsset({ name: 'foo-mac-arm64.DMG' })).toBe(false);
  });
});

describe('findBestMacAsset — preference matrix', () => {
  const assets = [
    { name: 'gtv-desktop-remote-mac-arm64.zip' },
    { name: 'gtv-desktop-remote-mac-x64.zip' },
    { name: 'gtv-desktop-remote-mac-arm64.dmg' },
    { name: 'gtv-desktop-remote-mac-x64.dmg' },
    { name: 'gtv-desktop-remote-linux-x64.tar.gz' },
  ];

  it('picks the arch-matched zip for arm64', () => {
    expect(findBestMacAsset(assets, 'arm64')?.name).toBe('gtv-desktop-remote-mac-arm64.zip');
  });

  it('picks the arch-matched zip for x64', () => {
    expect(findBestMacAsset(assets, 'x64')?.name).toBe('gtv-desktop-remote-mac-x64.zip');
  });

  it('falls back to any mac zip when arch zip absent', () => {
    const noArm = assets.filter((a) => a.name !== 'gtv-desktop-remote-mac-arm64.zip');
    expect(findBestMacAsset(noArm, 'arm64')?.name).toBe('gtv-desktop-remote-mac-x64.zip');
  });

  it('falls back to arch-matched dmg when no zip exists', () => {
    const onlyDmg = assets.filter((a) => a.name.endsWith('.dmg'));
    expect(findBestMacAsset(onlyDmg, 'arm64')?.name).toBe('gtv-desktop-remote-mac-arm64.dmg');
  });

  it('falls back to any mac dmg when arch dmg absent', () => {
    const onlyX64Dmg = [{ name: 'gtv-desktop-remote-mac-x64.dmg' }];
    expect(findBestMacAsset(onlyX64Dmg, 'arm64')?.name).toBe('gtv-desktop-remote-mac-x64.dmg');
  });

  it('returns undefined when no mac asset exists', () => {
    const linuxOnly = [{ name: 'gtv-desktop-remote-linux-x64.tar.gz' }];
    expect(findBestMacAsset(linuxOnly, 'arm64')).toBeUndefined();
  });

  it('returns undefined for an empty asset list', () => {
    const empty: { name: string }[] = [];
    const result = findBestMacAsset(empty, 'arm64');
    expect(result).toBeUndefined();
  });

  it('ignores assets without the -mac- marker', () => {
    // A bare `.zip` should not be picked up even if it has the right extension.
    const tricky = [{ name: 'gtv-desktop-remote.zip' }, { name: 'gtv-desktop-remote.dmg' }];
    expect(findBestMacAsset(tricky, 'arm64')).toBeUndefined();
  });

  it('defaults arch to process.arch when omitted', () => {
    const result = findBestMacAsset(assets);
    // Whatever the host arch is, the result must include `-mac-` and end with .zip
    // (since both arch zips are present in our fixture).
    expect(result?.name).toMatch(/-mac-(arm64|x64)\.zip$/);
  });
});
