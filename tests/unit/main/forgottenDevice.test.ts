import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AndroidTvCertStore } from '../../../src/backend/devices/credentials/androidTvCertStore';
import { AndroidTvRemoteBridge } from '../../../src/main/device/androidTvRemote';

const mocks = vi.hoisted(() => ({
  loadOrCreate: vi.fn<AndroidTvCertStore['loadOrCreate']>(),
  clear: vi.fn<AndroidTvCertStore['clear']>(),
  migrate: vi.fn(),
  createPairingClient: vi.fn(),
}));

vi.mock('../../../src/backend/devices/credentials/androidTvCertStore', () => ({
  AndroidTvCertStore: class {
    loadOrCreate = mocks.loadOrCreate;
    clear = mocks.clear;
    migrate = mocks.migrate;
  },
}));
vi.mock('../../../src/backend/pairing/createPairingClient', () => ({
  createPairingClient: mocks.createPairingClient,
}));
vi.mock('../../../src/main/logger', () => ({
  createNodeLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  getAppDataPath: (...segments: string[]) => ['/profile', ...segments].join('/'),
  logError: vi.fn(),
}));
vi.mock('../../../src/main/capture', () => ({
  record: vi.fn(),
  recordBuffer: vi.fn(),
  isCaptureEnabled: () => false,
}));
vi.mock('../../../src/main/metrics', () => ({ commandMetricsStore: {} }));
vi.mock('../../../src/main/integrationEnvironment', () => ({ integrationEnvironment: undefined }));

function pairingClient() {
  return { start: vi.fn().mockResolvedValue({}), close: vi.fn().mockResolvedValue(undefined) };
}

describe('forgotten device authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loadOrCreate.mockImplementation((key: string) => Promise.resolve({ cert: key, key }));
    mocks.clear.mockResolvedValue(undefined);
    mocks.migrate.mockResolvedValue(undefined);
  });

  it('closes migrated host sessions, clears MAC and host credentials, and preserves another cache', async () => {
    const bridge = new AndroidTvRemoteBridge();
    const oldClient = pairingClient();
    const otherClient = pairingClient();
    const newClient = pairingClient();
    mocks.createPairingClient
      .mockResolvedValue(newClient)
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(otherClient)
      .mockResolvedValueOnce(newClient);
    await bridge.startPairing('192.0.2.1');
    await bridge.startPairing('192.0.2.2', 'other-mac');
    await bridge.migrateCerts('192.0.2.1', 'device-mac');

    await bridge.forgetDevice('192.0.2.3', 'device-mac');

    expect(oldClient.close).toHaveBeenCalledOnce();
    expect(otherClient.close).not.toHaveBeenCalled();
    expect(mocks.clear.mock.calls.map(([key]) => key)).toEqual([
      'device-mac',
      '192.0.2.3',
      '192.0.2.1',
    ]);
    const loadsBefore = mocks.loadOrCreate.mock.calls.length;
    await bridge.startPairing('192.0.2.2', 'other-mac');
    expect(mocks.loadOrCreate).toHaveBeenCalledTimes(loadsBefore);
    await bridge.startPairing('192.0.2.1', 'device-mac');
    expect(mocks.loadOrCreate).toHaveBeenCalledTimes(loadsBefore + 1);
    expect(mocks.createPairingClient).toHaveBeenCalledTimes(4);
  });

  it('awaits pairing closure before deleting authorization and surfaces close failure', async () => {
    const bridge = new AndroidTvRemoteBridge();
    const client = pairingClient();
    client.close.mockRejectedValueOnce(new Error('close failed'));
    mocks.createPairingClient.mockResolvedValue(client);
    await bridge.startPairing('192.0.2.1');
    await expect(bridge.forgetDevice('192.0.2.1')).rejects.toThrow('close failed');
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it('surfaces credential deletion failure instead of reporting forgotten authorization', async () => {
    const bridge = new AndroidTvRemoteBridge();
    mocks.clear.mockRejectedValueOnce(new Error('permission denied'));
    await expect(bridge.forgetDevice('192.0.2.1')).rejects.toThrow('permission denied');
  });

  it('cancels a pending PIN exchange without deleting authorization and allows a fresh pairing', async () => {
    const bridge = new AndroidTvRemoteBridge();
    const first = pairingClient();
    const second = pairingClient();
    mocks.createPairingClient.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await bridge.startPairing('192.0.2.1', 'device-mac');
    await bridge.cancelPairing('192.0.2.1');
    expect(first.close).toHaveBeenCalledOnce();
    expect(mocks.clear).not.toHaveBeenCalled();
    await bridge.startPairing('192.0.2.1', 'device-mac');
    expect(second.start).toHaveBeenCalledOnce();
  });
});
