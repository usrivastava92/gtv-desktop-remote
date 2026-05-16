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
import { ConnectionManager, DEFAULT_DEVICE_STATE } from './connectionManager';
import { discoverGoogleTvDevices } from './discovery';
import { clearDeviceStore, readDevices, writeDevices } from './store';

function getLegacyUserDataPaths(): string[] {
  const appDataRoot = app.getPath('appData');
  return [getAppDataPath(), path.join(appDataRoot, 'GTV Desktop Remote')];
}

export class GoogleTvAdapter implements DeviceAdapter {
  private readonly connectionManager = new ConnectionManager();

  private scanPromise: Promise<DiscoveredDevice[]> | undefined;

  private assistantVoiceStats = new Map<
    number,
    { chunks: number; bytes: number; startedAt: number }
  >();

  onDeviceStateChanged(listener: (state: DeviceState) => void): () => void {
    return this.connectionManager.onStateChanged(listener);
  }

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
      const fingerprintMatches =
        saved.deviceFingerprint &&
        discovered.filter((d) => d.deviceFingerprint === saved.deviceFingerprint);
      const match = discovered.find((d) => {
        if (saved.macAddress && d.macAddress) {
          return d.macAddress === saved.macAddress;
        }
        if (saved.castDeviceId && d.castDeviceId) {
          return d.castDeviceId === saved.castDeviceId;
        }
        if (saved.networkHostName && d.networkHostName) {
          return d.networkHostName === saved.networkHostName;
        }
        if (fingerprintMatches && fingerprintMatches.length === 1) {
          return d.id === fingerprintMatches[0]?.id;
        }
        return d.host === saved.host;
      });
      if (!match) return saved;
      if (match.host === saved.host) {
        return {
          ...saved,
          macAddress: saved.macAddress ?? match.macAddress,
          castDeviceId: saved.castDeviceId ?? match.castDeviceId,
          networkHostName: saved.networkHostName ?? match.networkHostName,
          deviceFingerprint: saved.deviceFingerprint ?? match.deviceFingerprint,
        };
      }
      void logInfo('adapter', 'Device IP changed — updating host', {
        deviceId: saved.id,
        name: saved.name,
        oldHost: saved.host,
        newHost: match.host,
        macAddress: saved.macAddress,
        castDeviceId: saved.castDeviceId,
        networkHostName: saved.networkHostName,
        deviceFingerprint: saved.deviceFingerprint,
      });
      return {
        ...saved,
        host: match.host,
        macAddress: saved.macAddress ?? match.macAddress,
        castDeviceId: saved.castDeviceId ?? match.castDeviceId,
        networkHostName: saved.networkHostName ?? match.networkHostName,
        deviceFingerprint: saved.deviceFingerprint ?? match.deviceFingerprint,
      };
    });

    const updatedDevicesChanged = updatedDevices.some((updated, i) => {
      const previous = savedDevices[i];
      return (
        updated.host !== previous.host ||
        updated.macAddress !== previous.macAddress ||
        updated.castDeviceId !== previous.castDeviceId ||
        updated.networkHostName !== previous.networkHostName ||
        updated.deviceFingerprint !== previous.deviceFingerprint
      );
    });
    if (updatedDevicesChanged) {
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
    const normalizedMac = draft.macAddress?.trim();
    const normalizedCastDeviceId = draft.castDeviceId?.trim();
    const normalizedNetworkHostName = draft.networkHostName?.trim();
    const normalizedDeviceFingerprint = draft.deviceFingerprint?.trim();
    const existingDevice = devices.find((device) => {
      if (normalizedMac && device.macAddress) {
        return device.macAddress === normalizedMac;
      }
      if (normalizedCastDeviceId && device.castDeviceId) {
        return device.castDeviceId === normalizedCastDeviceId;
      }
      if (normalizedNetworkHostName && device.networkHostName) {
        return device.networkHostName === normalizedNetworkHostName;
      }
      if (normalizedDeviceFingerprint && device.deviceFingerprint) {
        return device.deviceFingerprint === normalizedDeviceFingerprint;
      }
      return device.host === normalizedHost;
    });

    const nextDevice: SavedDevice = {
      id: existingDevice?.id ?? randomUUID(),
      isPaired: existingDevice?.isPaired ?? false,
      name: draft.name.trim() || normalizedHost,
      host: normalizedHost,
      adbPort: draft.adbPort,
      pairingPort: draft.pairingPort,
      macAddress: normalizedMac ?? existingDevice?.macAddress,
      castDeviceId: normalizedCastDeviceId ?? existingDevice?.castDeviceId,
      networkHostName: normalizedNetworkHostName ?? existingDevice?.networkHostName,
      deviceFingerprint: normalizedDeviceFingerprint ?? existingDevice?.deviceFingerprint,
      lastConnectedAt: existingDevice?.lastConnectedAt,
    };

    const nextDevices = [
      ...devices.filter((device) => device.id !== existingDevice?.id),
      nextDevice,
    ];
    await writeDevices(nextDevices);
    this.connectionManager.setState({
      ...this.connectionManager.state,
      message: `Saved ${nextDevice.name}. Pair once, then connect.`,
    });
    return nextDevices;
  }

  async removeDevice(deviceId: string): Promise<SavedDevice[]> {
    await logInfo('adapter', 'Removing device', { deviceId });
    const devices = await readDevices();
    const nextDevices = devices.filter((device) => device.id !== deviceId);
    await writeDevices(nextDevices);

    if (this.connectionManager.active?.id === deviceId) {
      this.connectionManager.setIdle();
    }

    return nextDevices;
  }

  async resetState(): Promise<DeviceState> {
    await logInfo('adapter', 'Resetting app state');

    await this.connectionManager.reset();
    await clearDeviceStore();

    for (const userDataPath of getLegacyUserDataPaths()) {
      await fs.rm(path.join(userDataPath, 'devices.json'), { force: true });
      await fs.rm(path.join(userDataPath, 'androidtvremote'), { force: true, recursive: true });
    }

    return this.connectionManager.setState({
      ...DEFAULT_DEVICE_STATE,
      message: 'App state reset. Pair your devices again.',
    });
  }

  async pair(request: PairingRequest): Promise<void> {
    await logInfo('adapter', 'Starting pairing', { request: { ...request, code: '[redacted]' } });
    this.connectionManager.setState({
      status: 'connecting',
      message: `Finishing pairing with ${request.host}...`,
      transport: { host: request.host.trim() },
    });

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
      this.connectionManager.setState({
        status: 'idle',
        message: 'Pairing succeeded. You can connect now.',
      });
    } catch (error) {
      await logError('adapter', 'Pairing failed', error);
      this.connectionManager.setState({
        status: 'error',
        message: (error as Error).message,
        transport: { host: request.host.trim(), lastError: (error as Error).message },
      });
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

    this.connectionManager.setActiveDevice(undefined);
    try {
      androidTvRemoteBridge.disconnect(device.host);
    } catch {
      // Ignore disconnect failures before pairing; a stale remote session should not block pairing.
    }

    this.connectionManager.setState({
      status: 'connecting',
      message: `Requesting pairing code from ${device.name}...`,
      transport: { host: device.host },
    });

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
      this.connectionManager.setState({
        status: 'idle',
        message: `Enter the 6-digit code shown on ${device.name}.`,
      });
      return this.connectionManager.state;
    } catch (error) {
      await logError('adapter', 'Seamless pairing start failed', error);
      this.connectionManager.setState({
        status: 'error',
        message: (error as Error).message,
        transport: { host: device.host, lastError: (error as Error).message },
      });
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

    try {
      const result = await this.connectionManager.connect(device);
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
      const activeDevice = nextDevices.find((item) => item.id === device.id);
      this.connectionManager.setActiveDevice(activeDevice);
      const deviceState = this.connectionManager.setState({
        status: 'connected',
        activeDeviceId: device.id,
        message: `Connected to ${device.name}.`,
        transport: {
          host: device.host,
          lastActivityAt: this.connectionManager.state.transport?.lastActivityAt,
        },
      });
      await logInfo('adapter', 'Connection succeeded', { deviceId: device.id, host: device.host });
      return deviceState;
    } catch (error) {
      await logError('adapter', 'Connection failed', error);
      throw error;
    }
  }

  async disconnect(): Promise<DeviceState> {
    await logInfo('adapter', 'Disconnect requested', {
      activeDeviceId: this.connectionManager.active?.id,
    });
    if (!this.connectionManager.active) {
      return this.connectionManager.setIdle();
    }

    return this.connectionManager.disconnect();
  }

  async sendCommand(request: CommandDispatchRequest): Promise<void> {
    const activeDevice = this.connectionManager.active;
    commandMetricsStore.recordAdapterDispatchStart(request, {
      deviceId: activeDevice?.id,
      host: activeDevice?.host,
    });

    if (!activeDevice) {
      const errorMessage = 'No active device connected.';
      commandMetricsStore.recordCommandFailed(request, {
        reason: 'no_active_device',
        errorMessage,
      });
      throw new Error(errorMessage);
    }

    await this.connectionManager.sendCommand(request);
    commandMetricsStore.recordAdapterDispatchCompleted(request.id);
  }

  async sendText(text: string): Promise<void> {
    await this.connectionManager.sendText(text);
  }

  async startAssistantVoice(): Promise<number> {
    const activeDevice = this.connectionManager.active;
    const sessionId = await this.connectionManager.startAssistantVoice();
    await logInfo('adapter', 'Assistant voice session started', {
      deviceId: activeDevice?.id,
      host: activeDevice?.host,
      sessionId,
    });
    this.assistantVoiceStats.set(sessionId, { chunks: 0, bytes: 0, startedAt: Date.now() });
    return sessionId;
  }

  async sendAssistantVoiceChunk(sessionId: number, chunkBase64: string): Promise<void> {
    const activeDevice = this.connectionManager.active;
    const chunk = Buffer.from(chunkBase64, 'base64');
    await this.connectionManager.sendAssistantVoiceChunk(sessionId, chunk);

    const stats = this.assistantVoiceStats.get(sessionId);
    if (stats) {
      stats.chunks += 1;
      stats.bytes += chunk.length;
      if (stats.chunks % 10 === 0) {
        await logInfo('adapter', 'Assistant voice chunk progress', {
          deviceId: activeDevice?.id,
          host: activeDevice?.host,
          sessionId,
          chunks: stats.chunks,
          bytes: stats.bytes,
        });
      }
    } else {
      await logInfo('adapter', 'Assistant voice chunk sent without tracked session', {
        deviceId: activeDevice?.id,
        host: activeDevice?.host,
        sessionId,
        bytes: chunk.length,
      });
    }
  }

  async stopAssistantVoice(sessionId: number): Promise<void> {
    const activeDevice = this.connectionManager.active;
    await this.connectionManager.stopAssistantVoice(sessionId);
    const stats = this.assistantVoiceStats.get(sessionId);
    this.assistantVoiceStats.delete(sessionId);
    await logInfo('adapter', 'Assistant voice session ended', {
      deviceId: activeDevice?.id,
      host: activeDevice?.host,
      sessionId,
      chunks: stats?.chunks ?? 0,
      bytes: stats?.bytes ?? 0,
      durationMs: stats ? Date.now() - stats.startedAt : undefined,
    });
  }

  async hasPendingAssistantVoiceSession(): Promise<boolean> {
    return this.connectionManager.hasPendingAssistantVoiceSession();
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
      deviceState: this.connectionManager.state,
    };
  }
}
