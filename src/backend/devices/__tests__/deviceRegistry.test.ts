import { describe, expect, it } from 'vitest';

import type { DeviceDraft, DiscoveredDevice, SavedDevice } from '../../../shared/types';
import {
  findExistingForDraft,
  identityChanged,
  matchSavedToDiscovered,
  mergeIdentity,
  normalizeDraft,
} from '../deviceRegistry';

function saved(overrides: Partial<SavedDevice> = {}): SavedDevice {
  return {
    id: 'saved-1',
    isPaired: true,
    name: 'TV',
    host: '192.168.1.5',
    adbPort: 5555,
    pairingPort: 6467,
    ...overrides,
  };
}

function discovered(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    id: 'disc-1',
    host: '192.168.1.5',
    ...overrides,
  } as DiscoveredDevice;
}

function draft(overrides: Partial<DeviceDraft> = {}): DeviceDraft {
  return {
    name: 'TV',
    host: '192.168.1.5',
    adbPort: 5555,
    pairingPort: 6467,
    ...overrides,
  };
}

describe('matchSavedToDiscovered — Google TV non-regression gate', () => {
  describe('priority order: MAC > castDeviceId > networkHostName > fingerprint > host', () => {
    it('matches by MAC when both sides have one (ignores host change)', () => {
      const s = saved({ host: 'OLD', macAddress: 'AA:BB:CC' });
      const d = discovered({ host: 'NEW', macAddress: 'AA:BB:CC' });
      expect(matchSavedToDiscovered(s, [d])).toEqual(d);
    });

    it('falls through past MAC if either side lacks it', () => {
      const s = saved({ macAddress: 'AA:BB:CC', castDeviceId: 'cast-1' });
      // Discovered has no MAC, but does have matching castDeviceId.
      const d = discovered({ castDeviceId: 'cast-1' });
      expect(matchSavedToDiscovered(s, [d])).toEqual(d);
    });

    it('matches by castDeviceId when neither has MAC', () => {
      const s = saved({ host: 'OLD', castDeviceId: 'cast-1' });
      const d = discovered({ host: 'NEW', castDeviceId: 'cast-1' });
      expect(matchSavedToDiscovered(s, [d])).toEqual(d);
    });

    it('matches by networkHostName when neither has MAC nor castDeviceId', () => {
      const s = saved({ host: 'OLD', networkHostName: 'living-room.local' });
      const d = discovered({ host: 'NEW', networkHostName: 'living-room.local' });
      expect(matchSavedToDiscovered(s, [d])).toEqual(d);
    });

    it('matches by fingerprint ONLY when exactly one discovered device has it', () => {
      const s = saved({ host: 'OLD', deviceFingerprint: 'fp-1' });
      const d1 = discovered({ id: 'one', host: 'NEW', deviceFingerprint: 'fp-1' });
      expect(matchSavedToDiscovered(s, [d1])).toEqual(d1);
    });

    it('does NOT match by fingerprint when multiple discovered devices have the same one', () => {
      const s = saved({ host: 'NOT-FOUND', deviceFingerprint: 'fp-1' });
      const d1 = discovered({ id: 'one', host: 'NEW-1', deviceFingerprint: 'fp-1' });
      const d2 = discovered({ id: 'two', host: 'NEW-2', deviceFingerprint: 'fp-1' });
      // Ambiguity → fall through to host match → neither host matches → undefined.
      expect(matchSavedToDiscovered(s, [d1, d2])).toBeUndefined();
    });

    it('falls through to host match as a last resort', () => {
      const s = saved({ host: '192.168.1.5' });
      const d = discovered({ host: '192.168.1.5' });
      expect(matchSavedToDiscovered(s, [d])).toEqual(d);
    });

    it('returns undefined when nothing matches', () => {
      const s = saved({ host: '10.0.0.1' });
      const d = discovered({ host: '192.168.1.5' });
      expect(matchSavedToDiscovered(s, [d])).toBeUndefined();
    });

    it('returns undefined for an empty discovered list', () => {
      expect(matchSavedToDiscovered(saved(), [])).toBeUndefined();
    });
  });
});

describe('mergeIdentity', () => {
  it('preserves host when the match has the same host (backfill identity)', () => {
    const s = saved({ host: '192.168.1.5' });
    const d = discovered({
      host: '192.168.1.5',
      macAddress: 'AA:BB:CC',
      castDeviceId: 'cast-1',
    });
    const result = mergeIdentity(s, d);
    expect(result.host).toBe('192.168.1.5');
    expect(result.macAddress).toBe('AA:BB:CC');
    expect(result.castDeviceId).toBe('cast-1');
    expect(result.isPaired).toBe(true); // preserved
  });

  it('does not overwrite existing identity fields on a same-host match', () => {
    const s = saved({ host: '192.168.1.5', macAddress: 'EXISTING' });
    const d = discovered({ host: '192.168.1.5', macAddress: 'NEW' });
    expect(mergeIdentity(s, d).macAddress).toBe('EXISTING');
  });

  it('updates host when the match has a different host (IP change)', () => {
    const s = saved({ host: 'OLD', macAddress: 'AA:BB:CC' });
    const d = discovered({ host: 'NEW', macAddress: 'AA:BB:CC' });
    const result = mergeIdentity(s, d);
    expect(result.host).toBe('NEW');
    expect(result.macAddress).toBe('AA:BB:CC');
  });

  it('backfills identity fields on an IP-change merge', () => {
    const s = saved({ host: 'OLD' });
    const d = discovered({
      host: 'NEW',
      macAddress: 'NEW-MAC',
      castDeviceId: 'NEW-CAST',
      networkHostName: 'new-host.local',
      deviceFingerprint: 'NEW-FP',
    });
    const result = mergeIdentity(s, d);
    expect(result).toMatchObject({
      host: 'NEW',
      macAddress: 'NEW-MAC',
      castDeviceId: 'NEW-CAST',
      networkHostName: 'new-host.local',
      deviceFingerprint: 'NEW-FP',
    });
  });

  it('preserves pairing state across an IP change', () => {
    const s = saved({ host: 'OLD', isPaired: true });
    const d = discovered({ host: 'NEW' });
    expect(mergeIdentity(s, d).isPaired).toBe(true);
  });
});

describe('identityChanged', () => {
  it('returns false for identical devices', () => {
    const a = saved();
    const b = saved();
    expect(identityChanged(a, b)).toBe(false);
  });

  it('detects host changes', () => {
    expect(identityChanged(saved({ host: 'OLD' }), saved({ host: 'NEW' }))).toBe(true);
  });

  it('detects MAC backfill', () => {
    expect(
      identityChanged(saved({ macAddress: undefined }), saved({ macAddress: 'AA:BB:CC' }))
    ).toBe(true);
  });

  it('ignores changes to non-identity fields (name, lastConnectedAt, isPaired)', () => {
    const previous = saved({ name: 'TV', isPaired: false });
    const updated = saved({ name: 'Living Room', isPaired: true });
    expect(identityChanged(previous, updated)).toBe(false);
  });
});

describe('findExistingForDraft', () => {
  const list: SavedDevice[] = [
    saved({ id: 'a', host: '10.0.0.1', macAddress: 'AA' }),
    saved({ id: 'b', host: '10.0.0.2', castDeviceId: 'CAST-B' }),
    saved({ id: 'c', host: '10.0.0.3', networkHostName: 'tv-c.local' }),
    saved({ id: 'd', host: '10.0.0.4', deviceFingerprint: 'FP-D' }),
    saved({ id: 'e', host: '10.0.0.5' }),
  ];

  it('matches by MAC when draft has one', () => {
    expect(findExistingForDraft(draft({ macAddress: 'AA' }), list)?.id).toBe('a');
  });

  it('matches by castDeviceId when MAC is absent', () => {
    expect(findExistingForDraft(draft({ castDeviceId: 'CAST-B' }), list)?.id).toBe('b');
  });

  it('matches by networkHostName when MAC + castDeviceId are absent', () => {
    expect(findExistingForDraft(draft({ networkHostName: 'tv-c.local' }), list)?.id).toBe('c');
  });

  it('matches by fingerprint when the higher-priority fields are absent', () => {
    expect(findExistingForDraft(draft({ deviceFingerprint: 'FP-D' }), list)?.id).toBe('d');
  });

  it('falls back to host', () => {
    expect(findExistingForDraft(draft({ host: '10.0.0.5' }), list)?.id).toBe('e');
  });

  it('returns undefined when nothing matches', () => {
    expect(findExistingForDraft(draft({ host: '99.99.99.99' }), list)).toBeUndefined();
  });

  it('trims whitespace before matching', () => {
    expect(findExistingForDraft(draft({ macAddress: '  AA  ' }), list)?.id).toBe('a');
  });
});

describe('normalizeDraft', () => {
  it('generates a fresh id for new devices using the injected generator', () => {
    const result = normalizeDraft(draft(), undefined, () => 'GENERATED');
    expect(result.id).toBe('GENERATED');
    expect(result.isPaired).toBe(false);
  });

  it('preserves the existing id, isPaired, and lastConnectedAt', () => {
    const existing = saved({ id: 'old-id', isPaired: true, lastConnectedAt: '2024-01-01' });
    const result = normalizeDraft(draft(), existing, () => 'NEW-id');
    expect(result.id).toBe('old-id');
    expect(result.isPaired).toBe(true);
    expect(result.lastConnectedAt).toBe('2024-01-01');
  });

  it('uses the draft name when non-empty', () => {
    const result = normalizeDraft(draft({ name: 'Custom Name' }), undefined, () => 'id');
    expect(result.name).toBe('Custom Name');
  });

  it('falls back to host when draft name is empty/whitespace', () => {
    const result = normalizeDraft(
      draft({ name: '   ', host: '192.168.1.5' }),
      undefined,
      () => 'id'
    );
    expect(result.name).toBe('192.168.1.5');
  });

  it('trims all identity strings', () => {
    const result = normalizeDraft(
      draft({ host: '  10.0.0.1  ', macAddress: '  AA  ', castDeviceId: '  CAST  ' }),
      undefined,
      () => 'id'
    );
    expect(result.host).toBe('10.0.0.1');
    expect(result.macAddress).toBe('AA');
    expect(result.castDeviceId).toBe('CAST');
  });

  it('prefers draft identity over existing where draft is set', () => {
    const existing = saved({ macAddress: 'OLD' });
    const result = normalizeDraft(draft({ macAddress: 'NEW' }), existing, () => 'id');
    expect(result.macAddress).toBe('NEW');
  });

  it('falls back to existing identity where draft is silent', () => {
    const existing = saved({ macAddress: 'OLD', castDeviceId: 'OLD-CAST' });
    const result = normalizeDraft(draft(), existing, () => 'id');
    expect(result.macAddress).toBe('OLD');
    expect(result.castDeviceId).toBe('OLD-CAST');
  });
});
