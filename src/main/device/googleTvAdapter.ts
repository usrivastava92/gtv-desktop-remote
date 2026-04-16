import { randomUUID } from 'node:crypto';

import type {
    BootstrapState,
    DeviceAdapter,
    DeviceCapabilities,
    DeviceDraft,
    DeviceState,
    DiscoveredDevice,
    PairingRequest,
    RemoteCommand,
    SavedDevice
} from '../../shared/types';
import { logError, logInfo } from '../logger';
import { androidTvRemoteBridge } from './androidTvRemote';
import { discoverGoogleTvDevices } from './discovery';
import { readDevices, writeDevices } from './store';

const DEFAULT_STATE: DeviceState = {
  status: 'idle',
  message: 'Add a Google TV or Android TV device to get started.'
};

export class GoogleTvAdapter implements DeviceAdapter {
  private activeDevice: SavedDevice | undefined;

  private deviceState: DeviceState = DEFAULT_STATE;

  async listDevices(): Promise<SavedDevice[]> {
    return readDevices();
  }

  async scanForDevices(): Promise<DiscoveredDevice[]> {
    await logInfo('adapter', 'Scanning local network for Google TV devices');
    const devices = await discoverGoogleTvDevices();
    await logInfo('adapter', 'Scan complete', { count: devices.length, devices });
    return devices;
  }

  async saveDevice(draft: DeviceDraft): Promise<SavedDevice[]> {
    await logInfo('adapter', 'Saving device', { draft });
    const devices = await readDevices();
    const normalizedHost = draft.host.trim();

    const nextDevice: SavedDevice = {
      id: randomUUID(),
      name: draft.name.trim() || normalizedHost,
      host: normalizedHost,
      adbPort: draft.adbPort,
      pairingPort: draft.pairingPort
    };

    const nextDevices = [...devices.filter((device) => device.host !== normalizedHost), nextDevice];
    await writeDevices(nextDevices);
    this.deviceState = {
      ...this.deviceState,
      message: `Saved ${nextDevice.name}. Pair once, then connect.`
    };
    return nextDevices;
  }

  async removeDevice(deviceId: string): Promise<SavedDevice[]> {
    await logInfo('adapter', 'Removing device', { deviceId });
    const devices = await readDevices();
    const nextDevices = devices.filter((device) => device.id !== deviceId);
    await writeDevices(nextDevices);

    if (this.activeDevice?.id === deviceId) {
      this.activeDevice = undefined;
      this.deviceState = DEFAULT_STATE;
    }

    return nextDevices;
  }

  async pair(request: PairingRequest): Promise<void> {
    await logInfo('adapter', 'Starting pairing', { request: { ...request, code: '[redacted]' } });
    this.deviceState = {
      status: 'connecting',
      message: `Finishing pairing with ${request.host}...`
    };

    try {
      await androidTvRemoteBridge.finishPairing(request.host.trim(), request.code.trim());
      await logInfo('adapter', 'Pairing succeeded', { host: request.host });
      this.deviceState = {
        status: 'idle',
        message: 'Pairing succeeded. You can connect now.'
      };
    } catch (error) {
      await logError('adapter', 'Pairing failed', error);
      this.deviceState = {
        status: 'error',
        message: (error as Error).message
      };
      throw error;
    }
  }

  async startPairing(deviceId: string): Promise<DeviceState> {
    await logInfo('adapter', 'Starting seamless pairing session', { deviceId });
    const devices = await readDevices();
    const device = devices.find((item) => item.id === deviceId);

    if (!device) {
      throw new Error('Saved device not found.');
    }

    this.deviceState = {
      status: 'connecting',
      activeDeviceId: device.id,
      message: `Requesting pairing code from ${device.name}...`
    };

    try {
      const result = await androidTvRemoteBridge.startPairing(device.host);
      const nextDevices = devices.map((item) =>
        item.id === device.id
          ? {
              ...item,
              macAddress: typeof result?.mac === 'string' ? result.mac : item.macAddress
            }
          : item
      );
      await writeDevices(nextDevices);
      this.deviceState = {
        status: 'idle',
        activeDeviceId: device.id,
        message: `Enter the 6-digit code shown on ${device.name}.`
      };
      return this.deviceState;
    } catch (error) {
      await logError('adapter', 'Seamless pairing start failed', error);
      this.deviceState = {
        status: 'error',
        activeDeviceId: device.id,
        message: (error as Error).message
      };
      throw error;
    }
  }

  async connect(deviceId: string): Promise<DeviceState> {
    await logInfo('adapter', 'Connecting device', { deviceId });
    const devices = await readDevices();
    const device = devices.find((item) => item.id === deviceId);

    if (!device) {
      throw new Error('Saved device not found.');
    }

    this.deviceState = {
      status: 'connecting',
      activeDeviceId: device.id,
      message: `Connecting to ${device.name}...`
    };

    try {
      const result = await androidTvRemoteBridge.connect(device.host);
      const nextDevices = devices.map((item) =>
        item.id === device.id
          ? {
              ...item,
              lastConnectedAt: new Date().toISOString(),
              macAddress: typeof result?.mac === 'string' ? result.mac : item.macAddress
            }
          : item
      );
      await writeDevices(nextDevices);
      this.activeDevice = nextDevices.find((item) => item.id === device.id);
      this.deviceState = {
        status: 'connected',
        activeDeviceId: device.id,
        message: `Connected to ${device.name}.`
      };
      await logInfo('adapter', 'Connection succeeded', { deviceId: device.id, host: device.host });
      return this.deviceState;
    } catch (error) {
      await logError('adapter', 'Connection failed', error);
      this.deviceState = {
        status: 'error',
        activeDeviceId: device.id,
        message: (error as Error).message
      };
      throw error;
    }
  }

  async disconnect(): Promise<DeviceState> {
    await logInfo('adapter', 'Disconnect requested', { activeDeviceId: this.activeDevice?.id });
    if (!this.activeDevice) {
      this.deviceState = DEFAULT_STATE;
      return this.deviceState;
    }

    try {
      await androidTvRemoteBridge.disconnect(this.activeDevice.host);
    } catch {
      // Ignore disconnect failures so the UI can recover to idle.
    }

    this.activeDevice = undefined;
    this.deviceState = {
      status: 'idle',
      message: 'Disconnected.'
    };
    return this.deviceState;
  }

  async sendCommand(command: RemoteCommand): Promise<void> {
    if (!this.activeDevice) {
      throw new Error('No active device connected.');
    }

    await androidTvRemoteBridge.sendCommand(this.activeDevice.host, command);
  }

  async sendText(text: string): Promise<void> {
    if (!this.activeDevice) {
      throw new Error('No active device connected.');
    }

    await androidTvRemoteBridge.sendText(this.activeDevice.host, text);
  }

  async getCapabilities(): Promise<DeviceCapabilities> {
    return {
      textInput: true,
      powerToggle: true
    };
  }

  async getBootstrapState(): Promise<BootstrapState> {
    return {
      devices: await readDevices(),
      deviceState: this.deviceState
    };
  }
}