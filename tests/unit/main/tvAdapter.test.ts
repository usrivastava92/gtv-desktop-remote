import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TvAdapter } from '../../../src/main/device/tvAdapter';
import type { TvProvider } from '../../../src/main/device/tvProvider';
import type { SavedDevice } from '../../../src/shared/types';

const store = vi.hoisted(() => ({
  devices: [] as SavedDevice[],
  integration: undefined as { discoveryPlatforms?: string[] } | undefined,
}));
vi.mock('electron', () => ({ app: { getPath: () => '/profile' } }));
vi.mock('../../../src/main/device/store', () => ({
  readDevices: () => Promise.resolve(store.devices),
  writeDevices: (devices: SavedDevice[]) => {
    store.devices = devices;
    return Promise.resolve();
  },
  clearDeviceStore: () => {
    store.devices = [];
    return Promise.resolve();
  },
}));
vi.mock('../../../src/main/integrationEnvironment', () => ({
  get integrationEnvironment() {
    return store.integration;
  },
}));
vi.mock('../../../src/main/logger', () => ({
  getAppDataPath: () => '/profile',
  logInfo: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('../../../src/main/metrics', () => ({
  commandMetricsStore: {
    recordAdapterDispatchStart: vi.fn(),
    recordAdapterDispatchCompleted: vi.fn(),
    recordCommandFailed: vi.fn(),
  },
}));

function provider(id: string) {
  return {
    id,
    name: id,
    capabilities: {
      textInput: false,
      powerToggle: false,
      assistantVoice: false,
      supportedCommands: ['up'],
    },
    discover: vi.fn().mockResolvedValue([]),
    startPairing: vi
      .fn()
      .mockResolvedValue({ instructions: 'PIN', codeLength: 4, inputPattern: '[0-9]' }),
    pair: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn(),
    forget: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    migrate: vi.fn().mockResolvedValue(undefined),
  } satisfies TvProvider;
}

function device(id: string, platform?: string): SavedDevice {
  return { id, platform, name: id, host: '192.0.2.1' };
}

function firstInvocation(order: readonly number[]): number {
  const first = order[0];
  if (first === undefined) throw new Error('Expected the mock to have been called.');
  return first;
}

beforeEach(() => {
  store.devices = [device('google'), device('apple', 'apple-tv')];
  store.integration = undefined;
});

describe('TvAdapter provider boundary', () => {
  it('disconnects the old provider before connecting another platform at the same host', async () => {
    const google = provider('google-tv');
    const apple = provider('apple-tv');
    const adapter = new TvAdapter([google, apple]);
    await adapter.connect('google');
    await adapter.connect('apple');
    expect(google.disconnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'google' }));
    expect(firstInvocation(google.disconnect.mock.invocationCallOrder)).toBeLessThan(
      firstInvocation(apple.connect.mock.invocationCallOrder)
    );
    expect((await adapter.getBootstrapState()).deviceState.activeDeviceId).toBe('apple');
  });

  it('binds PIN submission to saved identity and preserves two-step pairing', async () => {
    const google = provider('google-tv');
    const apple = provider('apple-tv');
    const step = { instructions: 'Second PIN', codeLength: 4, inputPattern: '[0-9]' };
    apple.pair.mockResolvedValueOnce(step);
    const adapter = new TvAdapter([google, apple]);
    await adapter.startPairing('apple');
    await expect(
      adapter.pair({ deviceId: 'google', host: '192.0.2.1', code: '1234' })
    ).rejects.toThrow('pending device');
    await expect(adapter.pair({ host: '192.0.2.1', code: '1234' })).rejects.toThrow(
      'pending device'
    );
    expect(apple.pair).not.toHaveBeenCalled();
    await adapter.pair({ deviceId: 'apple', host: '192.0.2.1', code: '1234' });
    expect((await adapter.getBootstrapState()).deviceState.pairing).toEqual(step);
    expect(store.devices.find(({ id }) => id === 'apple')?.isPaired).not.toBe(true);
    await adapter.pair({ deviceId: 'apple', host: '192.0.2.1', code: '5678' });
    expect((await adapter.getBootstrapState()).deviceState.pairing).toBeUndefined();
    expect(store.devices.find(({ id }) => id === 'apple')?.isPaired).toBe(true);
    expect(store.devices.find(({ id }) => id === 'google')?.isPaired).not.toBe(true);
  });

  it('closes a pending pairing on disconnect and rejects stale submissions', async () => {
    const apple = provider('apple-tv');
    const adapter = new TvAdapter([apple]);
    await adapter.startPairing('apple');
    await adapter.disconnect();
    expect(apple.disconnect).toHaveBeenCalledOnce();
    await expect(
      adapter.pair({ deviceId: 'apple', host: '192.0.2.1', code: '1234' })
    ).rejects.toThrow('pending device');
    expect((await adapter.getBootstrapState()).deviceState.pairing).toBeUndefined();
  });

  it('cleans a failed connection and enforces commands, text and voice capabilities', async () => {
    const apple = provider('apple-tv');
    const adapter = new TvAdapter([apple]);
    apple.connect.mockRejectedValueOnce(new Error('connection refused'));
    await expect(adapter.connect('apple')).rejects.toThrow('connection refused');
    expect(apple.disconnect).toHaveBeenCalledOnce();
    await adapter.connect('apple');
    await expect(
      adapter.sendCommand({ id: 'command', command: 'power', source: 'button', issuedAt: 1 })
    ).rejects.toThrow('not supported');
    await expect(adapter.sendText('hello')).rejects.toThrow('not supported');
    await expect(adapter.startAssistantVoice()).rejects.toThrow('not supported');
    expect(apple.sendCommand).not.toHaveBeenCalled();
    expect(apple.sendText).not.toHaveBeenCalled();
  });

  it('isolates discovery failures and never merges legacy Google records with another platform', async () => {
    const google = provider('google-tv');
    const apple = provider('apple-tv');
    google.discover.mockRejectedValue(new Error('unavailable'));
    apple.discover.mockResolvedValue([
      {
        id: 'native',
        name: 'Apple',
        host: '192.0.2.1',
        source: 'apple-tv',
        macAddress: 'native-mac',
      },
    ]);
    const adapter = new TvAdapter([google, apple]);
    expect(await adapter.scanForDevices()).toHaveLength(1);
    expect(store.devices.find(({ id }) => id === 'google')?.macAddress).toBeUndefined();
    expect(store.devices.find(({ id }) => id === 'apple')?.macAddress).toBe('native-mac');
  });

  it('disconnects before migrating an active native address and stops advertising the stale connection', async () => {
    const apple = provider('apple-tv');
    const previous = device('apple', 'apple-tv');
    previous.providerData = { identifier: 'stable-apple' };
    store.devices = [previous];
    apple.discover.mockResolvedValue([
      {
        id: 'native',
        name: 'Apple',
        host: '192.0.2.2',
        source: 'apple-tv',
        providerData: { identifier: 'stable-apple', port: 49153 },
      },
    ]);
    const adapter = new TvAdapter([apple]);
    await adapter.connect('apple');
    await adapter.scanForDevices();
    expect(apple.disconnect).toHaveBeenCalledWith(expect.objectContaining({ host: '192.0.2.1' }));
    expect(firstInvocation(apple.disconnect.mock.invocationCallOrder)).toBeLessThan(
      firstInvocation(apple.migrate.mock.invocationCallOrder)
    );
    expect((await adapter.getBootstrapState()).deviceState.status).toBe('idle');
    expect(store.devices[0]?.host).toBe('192.0.2.2');
    await expect(adapter.sendText('stale')).rejects.toThrow('No active device');
  });

  it('limits integration discovery without unregistering native providers', async () => {
    const google = provider('google-tv');
    const apple = provider('apple-tv');
    store.integration = {};
    const adapter = new TvAdapter([google, apple]);
    await adapter.scanForDevices();
    expect(google.discover).toHaveBeenCalledOnce();
    expect(apple.discover).not.toHaveBeenCalled();
    await adapter.connect('apple');
    expect(apple.connect).toHaveBeenCalledOnce();
    store.integration = { discoveryPlatforms: ['apple-tv'] };
    await adapter.scanForDevices();
    expect(google.discover).toHaveBeenCalledOnce();
    expect(apple.discover).toHaveBeenCalledOnce();
    store.integration = { discoveryPlatforms: [] };
    await adapter.scanForDevices();
    expect(apple.discover).toHaveBeenCalledOnce();
    store.integration = { discoveryPlatforms: ['unknown-provider'] };
    expect(() => new TvAdapter([google, apple])).toThrow('Unknown integration discovery platform');
  });
});
