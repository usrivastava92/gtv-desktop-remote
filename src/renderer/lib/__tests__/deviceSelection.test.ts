import { describe, expect, it } from 'vitest';

import type { DiscoveredDevice, SavedDevice } from '../../../shared/types';
import {
  derivePairedNetworkDevices,
  deriveUnpairedNetworkDevices,
  findDiscoveredForSaved,
  resolveSelectedDevice,
} from '../deviceSelection';

// Fixture builders keep each test focused on its assertion.
function saved(overrides: Partial<SavedDevice> = {}): SavedDevice {
  return {
    id: 'saved-1',
    name: 'Living Room TV',
    host: '192.168.1.10',
    adbPort: 5555,
    pairingPort: 6467,
    isPaired: true,
    ...overrides,
  };
}

function discovered(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    id: 'disc-1',
    name: 'Living Room TV',
    host: '192.168.1.10',
    adbPort: 5555,
    pairingPort: 6467,
    remotePort: 6466,
    source: 'androidtvremote',
    ...overrides,
  };
}

describe('findDiscoveredForSaved', () => {
  it('matches by MAC first (stable across IP changes)', () => {
    const s = saved({ host: '192.168.1.99', macAddress: 'aa:bb:cc:dd:ee:ff' });
    const pool: DiscoveredDevice[] = [
      // Same MAC, different IP (device moved to a new IP):
      discovered({ id: 'disc-X', host: '192.168.1.42', macAddress: 'aa:bb:cc:dd:ee:ff' }),
      // Same old IP but different MAC (a different device took over the IP):
      discovered({ id: 'disc-Y', host: '192.168.1.99', macAddress: '11:22:33:44:55:66' }),
    ];
    const match = findDiscoveredForSaved(s, pool);
    // Must prefer MAC match even though the host changed.
    expect(match?.id).toBe('disc-X');
  });

  it('falls back to host when MAC missing', () => {
    const s = saved({ host: '192.168.1.10', macAddress: undefined });
    const pool: DiscoveredDevice[] = [discovered({ host: '192.168.1.10' })];
    expect(findDiscoveredForSaved(s, pool)?.id).toBe('disc-1');
  });

  it('returns undefined when neither MAC nor host matches', () => {
    const s = saved({ host: '10.0.0.1', macAddress: 'aa:bb:cc:dd:ee:ff' });
    const pool: DiscoveredDevice[] = [discovered({ host: '192.168.1.1', macAddress: 'zz' })];
    expect(findDiscoveredForSaved(s, pool)).toBeUndefined();
  });

  it('matches by cast device id before falling back to host', () => {
    const s = saved({ host: '192.168.1.99', castDeviceId: 'cast-123' });
    const pool: DiscoveredDevice[] = [
      discovered({ id: 'disc-X', host: '192.168.1.42', castDeviceId: 'cast-123' }),
      discovered({ id: 'disc-Y', host: '192.168.1.99', castDeviceId: 'cast-456' }),
    ];
    expect(findDiscoveredForSaved(s, pool)?.id).toBe('disc-X');
  });

  it('matches by network host name before falling back to host', () => {
    const s = saved({ host: '192.168.1.99', networkHostName: 'bedroom-tv.local' });
    const pool: DiscoveredDevice[] = [
      discovered({ id: 'disc-X', host: '192.168.1.42', networkHostName: 'bedroom-tv.local' }),
      discovered({ id: 'disc-Y', host: '192.168.1.99', networkHostName: 'other-tv.local' }),
    ];
    expect(findDiscoveredForSaved(s, pool)?.id).toBe('disc-X');
  });

  it('matches by unique device fingerprint before falling back to host', () => {
    const s = saved({ host: '192.168.1.99', deviceFingerprint: 'fp-123' });
    const pool: DiscoveredDevice[] = [
      discovered({ id: 'disc-X', host: '192.168.1.42', deviceFingerprint: 'fp-123' }),
      discovered({ id: 'disc-Y', host: '192.168.1.99', deviceFingerprint: 'fp-456' }),
    ];
    expect(findDiscoveredForSaved(s, pool)?.id).toBe('disc-X');
  });

  it('does not match by ambiguous device fingerprint', () => {
    const s = saved({ host: '192.168.1.99', deviceFingerprint: 'fp-123' });
    const pool: DiscoveredDevice[] = [
      discovered({ id: 'disc-X', host: '192.168.1.42', deviceFingerprint: 'fp-123' }),
      discovered({ id: 'disc-Y', host: '192.168.1.43', deviceFingerprint: 'fp-123' }),
    ];
    expect(findDiscoveredForSaved(s, pool)).toBeUndefined();
  });

  it('returns undefined for empty discovery pool', () => {
    expect(findDiscoveredForSaved(saved(), [])).toBeUndefined();
  });
});

describe('derivePairedNetworkDevices', () => {
  it('includes only saved devices with isPaired=true', () => {
    const list = derivePairedNetworkDevices(
      [
        saved({ id: 's1', isPaired: true }),
        saved({ id: 's2', isPaired: false }), // <-- excluded
        saved({ id: 's3', isPaired: true }),
      ],
      []
    );
    expect(list.map((p) => p.key)).toEqual(['saved:s1', 'saved:s3']);
  });

  it('attaches the discovered counterpart when present', () => {
    const list = derivePairedNetworkDevices(
      [saved({ id: 's1', host: '192.168.1.10', macAddress: 'aa' })],
      [discovered({ id: 'd1', host: '192.168.1.10', macAddress: 'aa' })]
    );
    expect(list[0]?.discoveredDevice?.id).toBe('d1');
  });

  it('leaves discoveredDevice undefined when no counterpart found', () => {
    const list = derivePairedNetworkDevices([saved({ id: 's1', host: '10.0.0.1' })], []);
    expect(list[0]?.discoveredDevice).toBeUndefined();
  });

  it('produces stable key format saved:<id>', () => {
    const list = derivePairedNetworkDevices([saved({ id: 'abc-123' })], []);
    expect(list[0]?.key).toBe('saved:abc-123');
  });

  it('returns empty array when no saved devices are paired', () => {
    expect(derivePairedNetworkDevices([saved({ isPaired: false })], [discovered()])).toEqual([]);
  });
});

describe('deriveUnpairedNetworkDevices', () => {
  it('omits discovered devices that match a paired-saved device by host', () => {
    const list = deriveUnpairedNetworkDevices(
      [saved({ id: 's1', host: '192.168.1.10', isPaired: true })],
      [
        discovered({ id: 'd1', host: '192.168.1.10' }), // <-- excluded
        discovered({ id: 'd2', host: '192.168.1.20' }),
      ]
    );
    expect(list.map((d) => d.id)).toEqual(['d2']);
  });

  it('omits discovered devices that match a paired-saved device by MAC (different host)', () => {
    const list = deriveUnpairedNetworkDevices(
      [
        saved({
          id: 's1',
          host: '192.168.1.99', // saved host is stale
          macAddress: 'aa:bb:cc:dd:ee:ff',
          isPaired: true,
        }),
      ],
      [
        // Same MAC, different IP — should still be filtered out:
        discovered({ id: 'd1', host: '192.168.1.42', macAddress: 'aa:bb:cc:dd:ee:ff' }),
      ]
    );
    expect(list).toEqual([]);
  });

  it('omits discovered devices that match a paired-saved device by cast device id', () => {
    const list = deriveUnpairedNetworkDevices(
      [saved({ id: 's1', host: '192.168.1.99', castDeviceId: 'cast-123', isPaired: true })],
      [discovered({ id: 'd1', host: '192.168.1.42', castDeviceId: 'cast-123' })]
    );
    expect(list).toEqual([]);
  });

  it('omits discovered devices that match a paired-saved device by network host name', () => {
    const list = deriveUnpairedNetworkDevices(
      [
        saved({
          id: 's1',
          host: '192.168.1.99',
          networkHostName: 'bedroom-tv.local',
          isPaired: true,
        }),
      ],
      [discovered({ id: 'd1', host: '192.168.1.42', networkHostName: 'bedroom-tv.local' })]
    );
    expect(list).toEqual([]);
  });

  it('omits discovered devices that match a paired-saved device by unique fingerprint', () => {
    const list = deriveUnpairedNetworkDevices(
      [saved({ id: 's1', host: '192.168.1.99', deviceFingerprint: 'fp-123', isPaired: true })],
      [discovered({ id: 'd1', host: '192.168.1.42', deviceFingerprint: 'fp-123' })]
    );
    expect(list).toEqual([]);
  });

  it('keeps discovered devices when only an unpaired-saved device matches', () => {
    const list = deriveUnpairedNetworkDevices(
      [saved({ id: 's1', host: '192.168.1.10', isPaired: false })],
      [discovered({ id: 'd1', host: '192.168.1.10' })]
    );
    expect(list.map((d) => d.id)).toEqual(['d1']);
  });

  it('preserves discovery order', () => {
    const list = deriveUnpairedNetworkDevices(
      [],
      [discovered({ id: 'first' }), discovered({ id: 'second' }), discovered({ id: 'third' })]
    );
    expect(list.map((d) => d.id)).toEqual(['first', 'second', 'third']);
  });

  it('returns empty array when discovery is empty', () => {
    expect(deriveUnpairedNetworkDevices([saved()], [])).toEqual([]);
  });

  it('handles saved.macAddress=undefined cleanly (no NPE on host-only match)', () => {
    const list = deriveUnpairedNetworkDevices(
      [saved({ host: '192.168.1.10', macAddress: undefined, isPaired: true })],
      [discovered({ host: '192.168.1.42', macAddress: undefined })]
    );
    expect(list).toHaveLength(1);
  });
});

describe('resolveSelectedDevice', () => {
  const paired = derivePairedNetworkDevices(
    [saved({ id: 's1', name: 'LR' })],
    [discovered({ id: 'd1' })]
  );
  const unpaired: DiscoveredDevice[] = [discovered({ id: 'd-other', host: '10.0.0.5' })];

  it('returns a saved selection when key matches a paired entry', () => {
    const sel = resolveSelectedDevice('saved:s1', paired, unpaired);
    expect(sel).toMatchObject({ kind: 'saved', key: 'saved:s1' });
    expect(sel?.kind === 'saved' && sel.savedDevice.id).toBe('s1');
  });

  it('returns a discovered selection when key matches an unpaired entry', () => {
    const sel = resolveSelectedDevice('discovered:d-other', paired, unpaired);
    expect(sel).toMatchObject({ kind: 'discovered', key: 'discovered:d-other' });
    expect(sel?.kind === 'discovered' && sel.discoveredDevice.id).toBe('d-other');
  });

  it('returns undefined when key is undefined (no selection)', () => {
    expect(resolveSelectedDevice(undefined, paired, unpaired)).toBeUndefined();
  });

  it('returns undefined when key matches neither bucket', () => {
    expect(resolveSelectedDevice('saved:does-not-exist', paired, unpaired)).toBeUndefined();
  });

  it('returns undefined when key has the wrong prefix shape', () => {
    expect(resolveSelectedDevice('s1', paired, unpaired)).toBeUndefined();
  });

  it('saved match wins when a key could theoretically match both buckets', () => {
    const pairedWithCollidingId = derivePairedNetworkDevices([saved({ id: 's1' })], []);
    const sel = resolveSelectedDevice('saved:s1', pairedWithCollidingId, unpaired);
    expect(sel?.kind).toBe('saved');
  });
});
