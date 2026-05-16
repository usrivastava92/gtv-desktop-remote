import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  RemoteTransportEvent,
  RemoteTransportListener,
} from '../src/main/device/androidTvRemote';
import type { RemoteBridge } from '../src/main/device/connectionManager';
import { ConnectionManager } from '../src/main/device/connectionManager';
import type { CommandDispatchRequest, SavedDevice } from '../src/shared/types';

vi.mock('../src/main/logger', () => ({
  logError: vi.fn(() => Promise.resolve()),
  logInfo: vi.fn(() => Promise.resolve()),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/gtv-remote-test',
    isPackaged: false,
  },
}));

const device: SavedDevice = {
  id: 'device-1',
  host: '192.168.1.11',
  isPaired: true,
  macAddress: 'aa:bb:cc:dd:ee:ff',
  name: 'Bedroom TV',
};

const command: CommandDispatchRequest = {
  id: 'command-1',
  command: 'select',
  issuedAt: 100,
  source: 'button',
};

class FakeBridge implements RemoteBridge {
  connectCalls = 0;

  disconnectCalls = 0;

  sentCommands: CommandDispatchRequest[] = [];

  connected = false;

  stale = false;

  failConnect = false;

  pendingVoiceSession = false;

  lastActivityAt = 0;

  private listener: RemoteTransportListener | undefined;

  async connect(
    host: string,
    _certKey?: string,
    options?: { forceNew?: boolean; onLifecycleEvent?: RemoteTransportListener }
  ) {
    this.connectCalls += 1;
    this.listener = options?.onLifecycleEvent;
    if (this.failConnect) {
      throw new Error('reconnect failed');
    }

    this.connected = true;
    this.stale = false;
    this.lastActivityAt = Date.now();
    this.listener?.({ type: 'connected', host, lastActivityAt: this.lastActivityAt });
    return { name: host };
  }

  disconnect(_host: string): void {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  async reset(): Promise<void> {
    this.connected = false;
  }

  async sendCommand(_host: string, request: CommandDispatchRequest): Promise<void> {
    this.sentCommands.push(request);
  }

  sendText(): Promise<void> {
    return Promise.resolve();
  }

  async startAssistantVoice(): Promise<number> {
    return 42;
  }

  sendAssistantVoiceChunk(): Promise<void> {
    return Promise.resolve();
  }

  stopAssistantVoice(): Promise<void> {
    return Promise.resolve();
  }

  async hasPendingAssistantVoiceSession(): Promise<boolean> {
    return this.pendingVoiceSession;
  }

  isConnected(): boolean {
    return this.connected;
  }

  isStale(): boolean {
    return this.stale;
  }

  getLastActivityAt(): number | undefined {
    return this.lastActivityAt || undefined;
  }

  emit(event: RemoteTransportEvent): void {
    this.listener?.(event);
  }
}

describe('ConnectionManager', () => {
  let bridge: FakeBridge;
  let manager: ConnectionManager;

  beforeEach(() => {
    bridge = new FakeBridge();
    manager = new ConnectionManager(bridge);
  });

  it('moves to connected after a successful connect', async () => {
    await manager.connect(device);

    expect(manager.state.status).toBe('connected');
    expect(manager.state.activeDeviceId).toBe(device.id);
    expect(manager.state.transport?.host).toBe(device.host);
  });

  it('moves to lost when the active transport closes', async () => {
    await manager.connect(device);

    bridge.emit({ type: 'closed', host: device.host, lastActivityAt: 123 });

    expect(manager.state.status).toBe('lost');
    expect(manager.state.activeDeviceId).toBe(device.id);
    expect(manager.state.transport?.lastActivityAt).toBe(123);
  });

  it('reconnects once before sending a command on a stale transport', async () => {
    await manager.connect(device);
    bridge.stale = true;

    await manager.sendCommand(command);

    expect(bridge.connectCalls).toBe(2);
    expect(bridge.disconnectCalls).toBe(2);
    expect(bridge.sentCommands).toEqual([command]);
    expect(manager.state.status).toBe('connected');
  });

  it('moves to lost and rejects when stale reconnect fails', async () => {
    await manager.connect(device);
    bridge.stale = true;
    bridge.failConnect = true;

    await expect(manager.sendCommand(command)).rejects.toThrow('reconnect failed');

    expect(manager.state.status).toBe('lost');
    expect(manager.state.transport?.lastError).toBe('reconnect failed');
    expect(bridge.sentCommands).toEqual([]);
  });

  it('clears the previous transport before each manual connect', async () => {
    await manager.connect(device);
    await manager.connect(device);

    expect(bridge.connectCalls).toBe(2);
    expect(bridge.disconnectCalls).toBe(2);
  });

  it('disconnects to idle state', async () => {
    await manager.connect(device);

    const state = manager.disconnect();

    expect(state.status).toBe('idle');
    expect(manager.active).toBeUndefined();
    expect(bridge.disconnectCalls).toBe(2);
  });

  it('does not connect while checking assistant voice pending state', async () => {
    const pending = await manager.hasPendingAssistantVoiceSession();

    expect(pending).toBe(false);
    expect(bridge.connectCalls).toBe(0);
  });

  it('checks assistant voice pending state only for connected transport', async () => {
    await manager.connect(device);
    bridge.pendingVoiceSession = true;

    await expect(manager.hasPendingAssistantVoiceSession()).resolves.toBe(true);
    expect(bridge.connectCalls).toBe(1);
  });
});
