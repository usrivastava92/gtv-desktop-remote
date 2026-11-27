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

describe('provider-scoped identity', () => {
  it('does not deduplicate different platforms sharing a host or physical identity', () => {
    const legacy = saved({ macAddress: 'AA' });
    const native = discovered({ platform: 'apple-tv', macAddress: 'AA' });
    expect(matchSavedToDiscovered(legacy, [native])).toBeUndefined();
    expect(
      findExistingForDraft(draft({ platform: 'apple-tv', macAddress: 'AA' }), [legacy])
    ).toBeUndefined();
  });

  it('matches an explicit Google platform to legacy records', () => {
    const legacy = saved();
    expect(matchSavedToDiscovered(legacy, [discovered({ platform: 'google-tv' })])).toBeDefined();
    expect(findExistingForDraft(draft({ platform: 'google-tv' }), [legacy])).toBe(legacy);
  });

  it('uses native stable identifiers across address changes without falling back on conflicting hosts', () => {
    const native = saved({ platform: 'apple-tv', providerData: { identifier: 'apple-1' } });
    const moved = discovered({
      platform: 'apple-tv',
      host: 'NEW',
      providerData: { identifier: 'apple-1', port: 49153 },
    });
    expect(matchSavedToDiscovered(native, [moved])).toBe(moved);
    expect(mergeIdentity(native, moved).providerData).toEqual({
      identifier: 'apple-1',
      port: 49153,
    });
    expect(
      matchSavedToDiscovered(native, [
        discovered({
          platform: 'apple-tv',
          providerData: { identifier: 'apple-2' },
        }),
      ])
    ).toBeUndefined();
  });
});

describe('Fire TV discovery protocol aliases', () => {
  const mdnsId = 'living room._amzn-firetv._tcp.local';
  const uuid = 'uuid:12345678-1234-1234-1234-123456789abc';
  const otherUuid = 'uuid:87654321-1234-1234-1234-123456789abc';
  const dial = 'urn:dial-multiscreen-org:service:dial:1';

  it('migrates legacy mDNS pairing to co-observed SSDP and back without changing credential identity', () => {
    const paired = saved({
      platform: 'fire-tv',
      providerData: { identifier: mdnsId, serviceName: `${mdnsId}.`, protocol: 'https' },
      lastConnectedAt: '2026-01-01',
    });
    const both = discovered({
      platform: 'fire-tv',
      providerData: { identifier: uuid, mdnsIdentifier: mdnsId, serviceName: dial, port: 8080 },
    });
    expect(matchSavedToDiscovered(paired, [both])).toBe(both);
    const migrated = mergeIdentity(paired, both);
    expect(migrated).toMatchObject({
      id: paired.id,
      isPaired: true,
      lastConnectedAt: paired.lastConnectedAt,
      providerData: {
        identifier: uuid,
        mdnsIdentifier: mdnsId,
        ssdpIdentifier: uuid,
        protocol: 'https',
      },
    });
    const mdnsOnly = discovered({
      platform: 'fire-tv',
      providerData: { identifier: mdnsId, serviceName: `${mdnsId}.`, port: 8080 },
    });
    expect(matchSavedToDiscovered(migrated, [mdnsOnly])).toBe(mdnsOnly);
    const back = mergeIdentity(migrated, mdnsOnly);
    expect(back.id).toBe(paired.id);
    expect(back.providerData).toMatchObject({
      ssdpIdentifier: uuid,
      mdnsIdentifier: mdnsId,
      serviceName: dial,
    });
    expect(matchSavedToDiscovered(back, [both])).toBe(both);
    expect(identityChanged(paired, migrated)).toBe(true);
    expect(identityChanged(back, mergeIdentity(back, mdnsOnly))).toBe(false);
  });

  it('recognizes matching UUIDs after an address change even when mDNS is primary', () => {
    const paired = saved({ platform: 'fire-tv', providerData: { identifier: uuid } });
    const match = discovered({
      platform: 'fire-tv',
      host: '192.168.1.99',
      providerData: { identifier: mdnsId, mdnsIdentifier: mdnsId, ssdpIdentifier: uuid },
    });
    expect(matchSavedToDiscovered(paired, [match])).toBe(match);
    expect(mergeIdentity(paired, match).host).toBe(match.host);
  });

  it.each(['mdns-to-ssdp', 'ssdp-to-mdns'])(
    'rejects cross-host %s aliases without matching UUIDs',
    (direction) => {
      const paired = saved({
        platform: 'fire-tv',
        providerData:
          direction === 'mdns-to-ssdp'
            ? { identifier: mdnsId }
            : { identifier: uuid, mdnsIdentifier: mdnsId },
      });
      const candidate = discovered({
        platform: 'fire-tv',
        host: '192.168.1.99',
        providerData:
          direction === 'mdns-to-ssdp'
            ? { identifier: uuid, mdnsIdentifier: mdnsId }
            : { identifier: mdnsId },
      });
      expect(matchSavedToDiscovered(paired, [candidate])).toBeUndefined();
      expect(findExistingForDraft(draft({ ...candidate, name: 'TV' }), [paired])).toBeUndefined();
    }
  );

  it('preserves saved identity and readiness when saving the rediscovered card', () => {
    const paired = saved({
      platform: 'fire-tv',
      providerData: { identifier: uuid, mdnsIdentifier: mdnsId, serviceName: dial },
    });
    const candidate = draft({
      platform: 'fire-tv',
      providerData: { identifier: mdnsId, serviceName: `${mdnsId}.` },
    });
    const existing = findExistingForDraft(candidate, [paired]);
    expect(existing).toBe(paired);
    expect(normalizeDraft(candidate, existing)).toMatchObject({
      id: paired.id,
      isPaired: true,
      providerData: { ssdpIdentifier: uuid, serviceName: dial },
    });
  });

  it('rejects recycled hosts, conflicting UUIDs, cross-platform aliases and names alone', () => {
    const paired = saved({
      platform: 'fire-tv',
      providerData: { identifier: uuid, mdnsIdentifier: mdnsId },
    });
    for (const candidate of [
      discovered({
        platform: 'fire-tv',
        providerData: { identifier: otherUuid, mdnsIdentifier: mdnsId },
      }),
      discovered({
        platform: 'fire-tv',
        providerData: { identifier: 'other._amzn-firetv._tcp.local' },
      }),
      discovered({
        platform: 'apple-tv',
        providerData: { identifier: uuid, mdnsIdentifier: mdnsId },
      }),
    ]) {
      expect(matchSavedToDiscovered(paired, [candidate])).toBeUndefined();
      expect(findExistingForDraft(draft({ ...candidate, name: 'TV' }), [paired])).toBeUndefined();
    }
    const nameOnly = saved({ platform: 'fire-tv', providerData: { identifier: mdnsId } });
    expect(
      matchSavedToDiscovered(nameOnly, [
        discovered({
          platform: 'fire-tv',
          host: '192.168.1.99',
          providerData: { identifier: mdnsId },
        }),
      ])
    ).toBeUndefined();
    // Without co-observation, even the same address cannot prove a UUID/name alias.
    expect(
      matchSavedToDiscovered(nameOnly, [
        discovered({ platform: 'fire-tv', providerData: { identifier: uuid } }),
      ])
    ).toBeUndefined();
  });
});

describe('Fire TV canonical identities', () => {
  it('matches UUID rediscovery across IP changes and canonicalizes legacy mDNS service spelling', () => {
    const uuid = 'uuid:12345678-1234-1234-1234-123456789abc';
    const mdnsId = 'living room._amzn-firetv._tcp.local';
    const paired = saved({ platform: 'fire-tv', providerData: { identifier: uuid } });
    const moved = discovered({
      platform: 'fire-tv',
      host: '192.168.1.99',
      providerData: { identifier: uuid.toUpperCase() },
    });
    expect(matchSavedToDiscovered(paired, [moved])).toBe(moved);
    const legacy = saved({
      platform: 'fire-tv',
      providerData: { identifier: `${mdnsId.toUpperCase()}.` },
    });
    const coObserved = discovered({
      platform: 'fire-tv',
      providerData: { identifier: uuid, mdnsIdentifier: mdnsId },
    });
    expect(matchSavedToDiscovered(legacy, [coObserved])).toBe(coObserved);
  });
});

it('retains the authoritative Fire UUID and DIAL requirement through mDNS-only rediscovery', () => {
  const uuid = 'uuid:12345678-1234-1234-1234-123456789abc';
  const mdnsId = 'den._amzn-firetv._tcp.local';
  const dial = 'urn:dial-multiscreen-org:service:dial:1';
  const paired = saved({
    platform: 'fire-tv',
    providerData: { identifier: uuid, mdnsIdentifier: mdnsId, serviceName: dial },
  });
  const mdns = discovered({
    platform: 'fire-tv',
    providerData: { identifier: mdnsId, serviceName: `${mdnsId}.` },
  });
  const updated = mergeIdentity(paired, mdns);
  expect(updated.providerData).toMatchObject({
    identifier: uuid,
    ssdpIdentifier: uuid,
    mdnsIdentifier: mdnsId,
    serviceName: dial,
  });
  expect(
    normalizeDraft(
      draft({
        platform: 'fire-tv',
        providerData: mdns.providerData,
      }),
      paired
    ).providerData
  ).toEqual(updated.providerData);
});
