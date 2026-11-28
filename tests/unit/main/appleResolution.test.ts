import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type * as AppleLibrary from '@librecontrol/apple-tv' with { 'resolution-mode': 'import' };
import type { AppleTvBridge, AppleTvDeviceConfig } from '@librecontrol/apple-tv' with {
  'resolution-mode': 'import',
};
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppleTvProvider } from '../../../src/main/device/appleTvProvider';
import type { SavedDevice } from '../../../src/shared/types';

interface Receiver {
  name: string;
  identifier: string;
  address: string;
  addresses: string[];
  port: number;
  airplayPort: number;
  model: string;
  properties: Record<string, string>;
}
type Target = Pick<AppleTvDeviceConfig, 'host' | 'identifier' | 'name'>;
type Resolver = (devices: Receiver[], options: Target) => Receiver;

const state = vi.hoisted(() => ({
  devices: [] as Receiver[],
  selected: [] as Receiver[],
  resolve: undefined as Resolver | undefined,
}));

vi.mock('../../../src/main/device/providerCredentials', () => ({
  providerCredentials: {
    read: vi.fn().mockResolvedValue({ airplay: 'saved-airplay', companion: 'saved-companion' }),
  },
}));
vi.mock('../../../src/main/metrics', () => ({ commandMetricsStore: {} }));
vi.mock('@librecontrol/apple-tv', async (importOriginal) => {
  const library = await importOriginal<typeof AppleLibrary>();
  function select(options: Target) {
    if (!state.resolve) throw new Error('Installed Apple TV resolver was not loaded');
    state.selected.push(state.resolve(state.devices, options));
  }
  // Keep the real device, PairingClient and RemoteClient forwarding paths. Only
  // replace protocol I/O: both native bridge operations use this same resolver.
  const complete = () => Promise.resolve();
  const bridge: AppleTvBridge = {
    discover: vi.fn<AppleTvBridge['discover']>().mockResolvedValue([]),
    createPairing: (options) =>
      Promise.resolve({
        start: () => {
          select(options);
          const handshake: AppleLibrary.AppleTvPairingHandshake = {
            serviceName: 'apple-tv',
            protocols: ['airplay', 'companion'],
          };
          return Promise.resolve(handshake);
        },
        submitPin: vi.fn().mockResolvedValue({ paired: false, status: 'bad-pin' }),
        close: vi.fn(complete),
      }),
    connect: (options) => {
      select(options);
      const connection: AppleLibrary.AppleTvConnection = {
        sendKey: vi.fn(complete),
        sendKeyDown: vi.fn(complete),
        sendKeyUp: vi.fn(complete),
        assistant: vi.fn(complete),
        voiceStart: vi.fn(complete),
        voiceStop: vi.fn(complete),
        voiceStreamPcm: vi.fn(complete),
        inputText: vi.fn(complete),
        getText: vi.fn<AppleLibrary.AppleTvConnection['getText']>().mockResolvedValue(undefined),
        getKeyboardFocusState: vi
          .fn<AppleLibrary.AppleTvConnection['getKeyboardFocusState']>()
          .mockResolvedValue('unknown'),
        isConnected: vi.fn<AppleLibrary.AppleTvConnection['isConnected']>().mockResolvedValue(true),
        disconnect: vi.fn(complete),
      };
      return Promise.resolve(connection);
    },
  };
  return {
    ...library,
    createAppleTv: (config: AppleTvDeviceConfig) => library.createAppleTv({ ...config, bridge }),
  };
});

beforeAll(async () => {
  // Exercise the pinned Yarn patch's actual selection implementation, not a
  // duplicate test resolver. A static package import cannot access this internal
  // module because the package exports only its public adapter entry point.
  const nativeUrl = pathToFileURL(
    resolve(__dirname, '../../../node_modules/@librecontrol/apple-tv/dist/discovery/native.js')
  ).href;
  const native = (await import(/* @vite-ignore */ nativeUrl)) as {
    resolveDiscoveredDevice: Resolver;
  };
  state.resolve = native.resolveDiscoveredDevice;
});

function receiver(identifier: string, address: string): Receiver {
  return {
    name: 'Living Room',
    identifier,
    address,
    addresses: [address],
    port: 49153,
    airplayPort: 7000,
    model: 'AppleTV14,1',
    properties: {},
  };
}

beforeEach(() => {
  state.devices = [receiver('other-id', '192.0.2.10'), receiver('target-id', '192.0.2.20')];
  state.selected = [];
});

for (const operation of ['startPairing', 'connect'] as const) {
  describe(`Apple TV ${operation} target resolution`, () => {
    async function useTarget(host: string, identifier?: string) {
      const provider = new AppleTvProvider();
      const device: SavedDevice = {
        id: 'apple-tv:target-id',
        platform: 'apple-tv',
        name: 'Living Room',
        host,
        providerData: identifier === undefined ? {} : { identifier },
      };
      try {
        await provider[operation](device);
      } finally {
        await provider.disconnect(device);
      }
    }

    it('selects the exact identifier after an earlier receiver with the same name', async () => {
      await useTarget('192.0.2.20', 'target-id');
      expect(state.selected).toEqual([state.devices[1]]);
    });

    it('follows the exact identifier when the saved address is stale', async () => {
      await useTarget('192.0.2.99', 'target-id');
      expect(state.selected).toEqual([state.devices[1]]);
    });

    it('does not let a reassigned address beat the exact identifier', async () => {
      await useTarget('192.0.2.10', 'target-id');
      expect(state.selected).toEqual([state.devices[1]]);
    });

    it('uses an exact address when no identifier was saved', async () => {
      await useTarget('192.0.2.20');
      expect(state.selected).toEqual([state.devices[1]]);
    });

    it('matches any advertised address, including equivalent IPv6 spellings', async () => {
      const target = state.devices[1];
      if (!target) throw new Error('Missing target fixture');
      target.addresses.push('2001:db8::20');
      await useTarget('2001:0db8:0:0:0:0:0:20');
      expect(state.selected).toEqual([state.devices[1]]);
    });

    it('rejects duplicate identifiers rather than choosing the first same-name receiver', async () => {
      state.devices = [receiver('target-id', '192.0.2.10'), receiver('target-id', '192.0.2.20')];
      await expect(useTarget('192.0.2.20', 'target-id')).rejects.toThrow('target is ambiguous');
      expect(state.selected).toEqual([]);
    });

    it('rejects an unavailable identifier even if the address and name match another TV', async () => {
      await expect(useTarget('192.0.2.10', 'missing-id')).rejects.toThrow(
        'target was not discovered'
      );
      expect(state.selected).toEqual([]);
    });

    it('does not treat a partial identifier as an exact identity', async () => {
      await expect(useTarget('192.0.2.20', 'target')).rejects.toThrow('target was not discovered');
      expect(state.selected).toEqual([]);
    });

    it('never falls back to a matching display name without an exact address', async () => {
      await expect(useTarget('192.0.2.99')).rejects.toThrow('target was not discovered');
      expect(state.selected).toEqual([]);
    });

    it('rejects an empty discovery instead of guessing default service ports', async () => {
      state.devices = [];
      await expect(useTarget('192.0.2.20', 'target-id')).rejects.toThrow(
        'target was not discovered'
      );
      expect(state.selected).toEqual([]);
    });
  });
}
