import type { CommandDispatchRequest, DeviceState, SavedDevice } from '../../shared/types';
import { logError, logInfo } from '../logger';

import type {
  RemoteConnectResult,
  RemoteTransportEvent,
  RemoteTransportListener,
} from './androidTvRemote';
import { androidTvRemoteBridge } from './androidTvRemote';

export const DEFAULT_DEVICE_STATE: DeviceState = {
  status: 'idle',
  message: 'Add a Google TV or Android TV device to get started.',
};

export interface RemoteBridge {
  connect(
    host: string,
    certKey?: string,
    options?: { forceNew?: boolean; onLifecycleEvent?: RemoteTransportListener }
  ): Promise<RemoteConnectResult | undefined>;
  disconnect(host: string): void;
  reset(): Promise<void>;
  sendCommand(
    host: string,
    request: CommandDispatchRequest,
    certKey?: string,
    options?: { onLifecycleEvent?: RemoteTransportListener }
  ): Promise<void>;
  sendText(host: string, text: string, certKey?: string): Promise<void>;
  startAssistantVoice(host: string, certKey?: string): Promise<number>;
  sendAssistantVoiceChunk(
    host: string,
    sessionId: number,
    chunk: Buffer,
    certKey?: string
  ): Promise<void>;
  stopAssistantVoice(host: string, sessionId: number, certKey?: string): Promise<void>;
  hasPendingAssistantVoiceSession(host: string, certKey?: string): Promise<boolean>;
  isConnected(host: string): boolean;
  isStale(host: string): boolean;
  getLastActivityAt(host: string): number | undefined;
}

export class ConnectionManager {
  private activeDevice: SavedDevice | undefined;

  private deviceState: DeviceState = DEFAULT_DEVICE_STATE;

  private readonly listeners = new Set<(state: DeviceState) => void>();

  private readonly bridge: RemoteBridge;

  constructor(bridge: RemoteBridge = androidTvRemoteBridge) {
    this.bridge = bridge;
  }

  get state(): DeviceState {
    return this.deviceState;
  }

  get active(): SavedDevice | undefined {
    return this.activeDevice;
  }

  onStateChanged(listener: (state: DeviceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setActiveDevice(device: SavedDevice | undefined): void {
    this.activeDevice = device;
  }

  setState(state: DeviceState): DeviceState {
    this.deviceState = state;
    this.emitState();
    return this.deviceState;
  }

  setIdle(message = DEFAULT_DEVICE_STATE.message): DeviceState {
    this.activeDevice = undefined;
    return this.setState({ status: 'idle', message });
  }

  async connect(device: SavedDevice): Promise<RemoteConnectResult | undefined> {
    this.activeDevice = device;
    this.setState({
      status: 'connecting',
      activeDeviceId: device.id,
      message: `Connecting to ${device.name}...`,
      transport: { host: device.host },
    });

    try {
      this.bridge.disconnect(device.host);
      const result = await this.bridge.connect(device.host, device.macAddress, {
        forceNew: true,
        onLifecycleEvent: this.handleTransportEvent,
      });
      this.setConnected(device, `Connected to ${device.name}.`);
      return result;
    } catch (error) {
      this.activeDevice = undefined;
      const message = (error as Error).message;
      this.setState({
        status: 'error',
        message,
        transport: { host: device.host, lastError: message },
      });
      throw error;
    }
  }

  disconnect(): DeviceState {
    if (this.activeDevice) {
      this.bridge.disconnect(this.activeDevice.host);
    }

    return this.setIdle('Disconnected.');
  }

  async reset(message = 'App state reset. Pair your devices again.'): Promise<DeviceState> {
    this.activeDevice = undefined;
    await this.bridge.reset();
    return this.setState({ ...DEFAULT_DEVICE_STATE, message });
  }

  async sendCommand(request: CommandDispatchRequest): Promise<void> {
    const device = this.requireActiveDevice();
    await this.ensureActiveTransport(device, request.id);
    await this.bridge.sendCommand(device.host, request, device.macAddress, {
      onLifecycleEvent: this.handleTransportEvent,
    });
  }

  async sendText(text: string): Promise<void> {
    const device = this.requireActiveDevice();
    await this.ensureActiveTransport(device);
    await this.bridge.sendText(device.host, text, device.macAddress);
  }

  async startAssistantVoice(): Promise<number> {
    const device = this.requireActiveDevice();
    await this.ensureActiveTransport(device);
    return this.bridge.startAssistantVoice(device.host, device.macAddress);
  }

  async sendAssistantVoiceChunk(sessionId: number, chunk: Buffer): Promise<void> {
    const device = this.requireActiveDevice();
    await this.ensureActiveTransport(device);
    await this.bridge.sendAssistantVoiceChunk(device.host, sessionId, chunk, device.macAddress);
  }

  async stopAssistantVoice(sessionId: number): Promise<void> {
    const device = this.requireActiveDevice();
    await this.ensureActiveTransport(device);
    await this.bridge.stopAssistantVoice(device.host, sessionId, device.macAddress);
  }

  async hasPendingAssistantVoiceSession(): Promise<boolean> {
    if (!this.activeDevice || this.deviceState.status !== 'connected') {
      return false;
    }

    return this.bridge.hasPendingAssistantVoiceSession(
      this.activeDevice.host,
      this.activeDevice.macAddress
    );
  }

  private readonly handleTransportEvent = (event: RemoteTransportEvent): void => {
    const device = this.activeDevice;
    if (device?.host !== event.host) {
      return;
    }

    if (event.type === 'connected') {
      this.setConnected(device, `Connected to ${device.name}.`, event.lastActivityAt);
      return;
    }

    if (event.type === 'stale') {
      this.setState({
        status: 'reconnecting',
        activeDeviceId: device.id,
        message: `Reconnecting to ${device.name}...`,
        transport: { host: device.host, lastActivityAt: event.lastActivityAt },
      });
      return;
    }

    if (event.type === 'closed') {
      this.applyLostState(device, 'Remote connection closed.', event.lastActivityAt);
      return;
    }

    this.applyLostState(device, event.error.message, event.lastActivityAt);
  };

  private async ensureActiveTransport(device: SavedDevice, commandId?: string): Promise<void> {
    if (this.bridge.isConnected(device.host) && !this.bridge.isStale(device.host)) {
      return;
    }

    if (this.bridge.isStale(device.host)) {
      await logInfo('adapter', 'transport_stale_detected', {
        deviceId: device.id,
        host: device.host,
        commandId,
        lastActivityAt: this.bridge.getLastActivityAt(device.host),
      });
    }

    await this.reconnect(device, commandId);
  }

  private async reconnect(device: SavedDevice, commandId?: string): Promise<void> {
    await logInfo('adapter', 'transport_reconnect_started', {
      deviceId: device.id,
      host: device.host,
      commandId,
    });
    this.setState({
      status: 'reconnecting',
      activeDeviceId: device.id,
      message: `Reconnecting to ${device.name}...`,
      transport: {
        host: device.host,
        lastActivityAt: this.bridge.getLastActivityAt(device.host),
      },
    });

    try {
      this.bridge.disconnect(device.host);
      await this.bridge.connect(device.host, device.macAddress, {
        forceNew: true,
        onLifecycleEvent: this.handleTransportEvent,
      });
      await logInfo('adapter', 'transport_reconnect_succeeded', {
        deviceId: device.id,
        host: device.host,
        commandId,
      });
      this.setConnected(device, `Connected to ${device.name}.`);
    } catch (error) {
      await logError('adapter', 'transport_reconnect_failed', error);
      this.applyLostState(
        device,
        (error as Error).message,
        this.bridge.getLastActivityAt(device.host)
      );
      throw error;
    }
  }

  private setConnected(device: SavedDevice, message: string, lastActivityAt?: number): void {
    this.activeDevice = device;
    this.setState({
      status: 'connected',
      activeDeviceId: device.id,
      message,
      transport: {
        host: device.host,
        lastActivityAt: lastActivityAt ?? this.bridge.getLastActivityAt(device.host),
      },
    });
  }

  private applyLostState(device: SavedDevice, errorMessage: string, lastActivityAt?: number): void {
    void logInfo('adapter', 'transport_lost_state_applied', {
      deviceId: device.id,
      host: device.host,
      errorMessage,
      lastActivityAt,
    });
    this.setState({
      status: 'lost',
      activeDeviceId: device.id,
      message: `${device.name} disconnected. Connect again to resume control.`,
      transport: {
        host: device.host,
        lastActivityAt,
        lastError: errorMessage,
      },
    });
  }

  private requireActiveDevice(): SavedDevice {
    if (!this.activeDevice) {
      throw new Error('No active device connected.');
    }

    return this.activeDevice;
  }

  private emitState(): void {
    const snapshot = { ...this.deviceState };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
