import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import type {
  BootstrapState,
  CommandDispatchRequest,
  DeviceAdapter,
  DeviceCapabilities,
  DeviceDraft,
  DeviceState,
  DiscoveredDevice,
  PairingRequest,
  SavedDevice,
} from '../../shared/types';
import { getAppDataPath, logError, logInfo } from '../logger';
import { commandMetricsStore } from '../metrics';

import { androidTvRemoteBridge } from './androidTvRemote';
import { discoverGoogleTvDevices } from './discovery';
import { clearDeviceStore, readDevices, writeDevices } from './store';

const DEFAULT_STATE: DeviceState = {
  status: 'idle',
  message: 'Add a Google TV or Android TV device to get started.',
};

function getLegacyUserDataPaths(): string[] {
  const appDataRoot = app.getPath('appData');
  return [getAppDataPath(), path.join(appDataRoot, 'GTV Desktop Remote')];
}

export class GoogleTvAdapter implements DeviceAdapter {
  private activeDevice: SavedDevice | undefined;

  private deviceState: DeviceState = DEFAULT_STATE;

  private scanPromise: Promise<DiscoveredDevice[]> | undefined;

  async listDevices(): Promise<SavedDevice[]> {
    return readDevices();
  }

  async scanForDevices(): Promise<DiscoveredDevice[]> {
    if (this.scanPromise) {
      await logInfo('adapter', 'Joining in-flight Google TV device scan');
      return this.scanPromise;
    }

    this.scanPromise = this.runDeviceScan().finally(() => {
      this.scanPromise = undefined;
    });

    return this.scanPromise;
  }

  private async runDeviceScan(): Promise<DiscoveredDevice[]> {
    await logInfo('adapter', 'Scanning local network for Google TV devices');
    const discovered = await discoverGoogleTvDevices();
    await logInfo('adapter', 'Scan complete', { count: discovered.length, devices: discovered });

    // Auto-update saved device hosts when a device is found by MAC but on a new IP
    const savedDevices = await readDevices();
    const updatedDevices = savedDevices.map((saved) => {
      if (!saved.macAddress) return saved;
      const match = discovered.find(
        (d) => d.macAddress && d.macAddress === saved.macAddress && d.host !== saved.host
      );
      if (!match) return saved;
      void logInfo('adapter', 'Device IP changed — updating host', {
        deviceId: saved.id,
        name: saved.name,
        oldHost: saved.host,
        newHost: match.host,
        macAddress: saved.macAddress,
      });
      return { ...saved, host: match.host };
    });

    const updatedHosts = updatedDevices.some((d, i) => d.host !== savedDevices[i]?.host);
    if (updatedHosts) {
      await writeDevices(updatedDevices);
      // Migrate any IP-keyed cert files to MAC-keyed cert files for updated devices
      for (let i = 0; i < savedDevices.length; i++) {
        const old = savedDevices[i];
        const updated = updatedDevices[i];
        if (old.host !== updated.host && updated.macAddress) {
          await androidTvRemoteBridge.migrateCerts(old.host, updated.macAddress);
        }
      }
    }

    return discovered;
  }

  async saveDevice(draft: DeviceDraft): Promise<SavedDevice[]> {
    await logInfo('adapter', 'Saving device', { draft });
    const devices = await readDevices();
    const normalizedHost = draft.host.trim();

    const nextDevice: SavedDevice = {
      id: randomUUID(),
      isPaired: false,
      name: draft.name.trim() || normalizedHost,
      host: normalizedHost,
      adbPort: draft.adbPort,
      pairingPort: draft.pairingPort,
    };

    const nextDevices = [...devices.filter((device) => device.host !== normalizedHost), nextDevice];
    await writeDevices(nextDevices);
    this.deviceState = {
      ...this.deviceState,
      message: `Saved ${nextDevice.name}. Pair once, then connect.`,
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

  async resetState(): Promise<DeviceState> {
    await logInfo('adapter', 'Resetting app state');

    this.activeDevice = undefined;
    await androidTvRemoteBridge.reset();
    await clearDeviceStore();

    for (const userDataPath of getLegacyUserDataPaths()) {
      await fs.rm(path.join(userDataPath, 'devices.json'), { force: true });
      await fs.rm(path.join(userDataPath, 'androidtvremote'), { force: true, recursive: true });
    }

    this.deviceState = {
      ...DEFAULT_STATE,
      message: 'App state reset. Pair your devices again.',
    };

    return this.deviceState;
  }

  async pair(request: PairingRequest): Promise<void> {
    await logInfo('adapter', 'Starting pairing', { request: { ...request, code: '[redacted]' } });
    this.deviceState = {
      status: 'connecting',
      message: `Finishing pairing with ${request.host}...`,
    };

    try {
      await androidTvRemoteBridge.finishPairing(
        request.host.trim(),
        request.code.trim(),
        request.macAddress
      );
      const devices = await readDevices();
      const nextDevices = devices.map((device) =>
        device.host === request.host.trim()
          ? {
              ...device,
              isPaired: true,
            }
          : device
      );
      await writeDevices(nextDevices);
      await logInfo('adapter', 'Pairing succeeded', { host: request.host });
      this.deviceState = {
        status: 'idle',
        message: 'Pairing succeeded. You can connect now.',
      };
    } catch (error) {
      await logError('adapter', 'Pairing failed', error);
      this.deviceState = {
        status: 'error',
        message: (error as Error).message,
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

    this.activeDevice = undefined;
    try {
      androidTvRemoteBridge.disconnect(device.host);
    } catch {
      // Ignore disconnect failures before pairing; a stale remote session should not block pairing.
    }

    this.deviceState = {
      status: 'connecting',
      message: `Requesting pairing code from ${device.name}...`,
    };

    try {
      const result = await androidTvRemoteBridge.startPairing(device.host, device.macAddress);
      const nextDevices = devices.map((item) =>
        item.id === device.id
          ? {
              ...item,
              macAddress: typeof result?.mac === 'string' ? result.mac : item.macAddress,
            }
          : item
      );
      await writeDevices(nextDevices);
      this.deviceState = {
        status: 'idle',
        message: `Enter the 6-digit code shown on ${device.name}.`,
      };
      return this.deviceState;
    } catch (error) {
      await logError('adapter', 'Seamless pairing start failed', error);
      this.deviceState = {
        status: 'error',
        message: (error as Error).message,
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
      message: `Connecting to ${device.name}...`,
    };

    try {
      const result = await androidTvRemoteBridge.connect(device.host, device.macAddress);
      const nextDevices = devices.map((item) =>
        item.id === device.id
          ? {
              ...item,
              lastConnectedAt: new Date().toISOString(),
              macAddress: typeof result?.mac === 'string' ? result.mac : item.macAddress,
            }
          : item
      );
      await writeDevices(nextDevices);
      this.activeDevice = nextDevices.find((item) => item.id === device.id);
      this.deviceState = {
        status: 'connected',
        activeDeviceId: device.id,
        message: `Connected to ${device.name}.`,
      };
      await logInfo('adapter', 'Connection succeeded', { deviceId: device.id, host: device.host });
      return this.deviceState;
    } catch (error) {
      this.activeDevice = undefined;
      await logError('adapter', 'Connection failed', error);
      this.deviceState = {
        status: 'error',
        message: (error as Error).message,
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
      androidTvRemoteBridge.disconnect(this.activeDevice.host);
    } catch {
      // Ignore disconnect failures so the UI can recover to idle.
    }

    this.activeDevice = undefined;
    this.deviceState = {
      status: 'idle',
      message: 'Disconnected.',
    };
    return this.deviceState;
  }

  async sendCommand(request: CommandDispatchRequest): Promise<void> {
    commandMetricsStore.recordAdapterDispatchStart(request, {
      deviceId: this.activeDevice?.id,
      host: this.activeDevice?.host,
    });

    if (!this.activeDevice) {
      const errorMessage = 'No active device connected.';
      commandMetricsStore.recordCommandFailed(request, {
        reason: 'no_active_device',
        errorMessage,
      });
      throw new Error(errorMessage);
    }

    await androidTvRemoteBridge.sendCommand(
      this.activeDevice.host,
      request,
      this.activeDevice.macAddress
    );
    commandMetricsStore.recordAdapterDispatchCompleted(request.id);
  }

  async sendText(text: string): Promise<void> {
    if (!this.activeDevice) {
      throw new Error('No active device connected.');
    }

    await androidTvRemoteBridge.sendText(
      this.activeDevice.host,
      text,
      this.activeDevice.macAddress
    );
  }

  getCapabilities(): Promise<DeviceCapabilities> {
    return Promise.resolve({
      textInput: true,
      powerToggle: true,
    });
  }

  async getBootstrapState(): Promise<BootstrapState> {
    return {
      devices: await readDevices(),
      deviceState: this.deviceState,
    };
  }
}
