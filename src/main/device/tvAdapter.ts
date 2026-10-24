import { promises as fs } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import {
  findExistingForDraft,
  identityChanged,
  matchSavedToDiscovered,
  mergeIdentity,
  normalizeDraft,
  platformOf,
} from '../../backend/devices/deviceRegistry';
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
import { assertLoopbackHost, integrationEnvironment } from '../integrationEnvironment';
import { getAppDataPath, logError, logInfo } from '../logger';
import { commandMetricsStore } from '../metrics';

import { clearDeviceStore, readDevices, writeDevices } from './store';
import type { TvProvider } from './tvProvider';

const DEFAULT_STATE: DeviceState = { status: 'idle', message: 'Add a TV device to get started.' };
const NO_CAPABILITIES: DeviceCapabilities = {
  textInput: false,
  powerToggle: false,
  supportedCommands: [],
  assistantVoice: false,
};

export class TvAdapter implements DeviceAdapter {
  private readonly providers = new Map<string, TvProvider>();
  private activeDevice: SavedDevice | undefined;
  private pairingDevice: SavedDevice | undefined;
  private deviceState: DeviceState = DEFAULT_STATE;
  private scanPromise: Promise<DiscoveredDevice[]> | undefined;
  private lifecycle: Promise<unknown> = Promise.resolve();

  constructor(providers: readonly TvProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.id)) throw new Error(`Duplicate TV provider: ${provider.id}`);
      this.providers.set(provider.id, provider);
    }
    if (integrationEnvironment) {
      for (const platform of integrationEnvironment.discoveryPlatforms ?? ['google-tv']) {
        if (!this.providers.has(platform)) {
          throw new Error(`Unknown integration discovery platform: ${platform}`);
        }
      }
    }
  }

  private provider(device: SavedDevice | DeviceDraft): TvProvider {
    const provider = this.providers.get(platformOf(device));
    if (!provider) throw new Error(`Unsupported TV platform: ${platformOf(device)}`);
    return provider;
  }

  // Lifecycle operations cannot race a PIN submission, cancellation, or another connection.
  private transition<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(operation);
    this.lifecycle = result.catch(() => undefined);
    return result;
  }

  private async savedDevice(id: string): Promise<SavedDevice> {
    const device = (await readDevices()).find((item) => item.id === id);
    if (!device) throw new Error('Saved device not found.');
    return device;
  }

  private async closeSessions(): Promise<void> {
    const active = this.activeDevice;
    const pairing = this.pairingDevice;
    // Keep ownership until closure succeeds so a failed cleanup can be retried.
    this.deviceState = DEFAULT_STATE;
    if (active) {
      await this.provider(active).disconnect(active);
      this.activeDevice = undefined;
    }
    if (pairing && pairing.id !== active?.id) await this.provider(pairing).disconnect(pairing);
    this.pairingDevice = undefined;
    this.deviceState = DEFAULT_STATE;
  }

  async listDevices(): Promise<SavedDevice[]> {
    return readDevices();
  }

  scanForDevices(): Promise<DiscoveredDevice[]> {
    this.scanPromise ??= this.transition(() => this.runDeviceScan()).finally(() => {
      this.scanPromise = undefined;
    });
    return this.scanPromise;
  }

  private async runDeviceScan(): Promise<DiscoveredDevice[]> {
    const platforms = integrationEnvironment
      ? new Set(integrationEnvironment.discoveryPlatforms ?? ['google-tv'])
      : undefined;
    const results = await Promise.all(
      [...this.providers.values()]
        .filter((provider) => !platforms || platforms.has(provider.id))
        .map(async (provider) => {
          try {
            return (await provider.discover()).map((device) => ({
              ...device,
              platform: provider.id,
            }));
          } catch (error) {
            await logError('adapter', `Discovery failed for ${provider.name}`, error);
            return [];
          }
        })
    );
    const discovered = results.flat();
    const devices = await readDevices();
    const changes: { previous: SavedDevice; next: SavedDevice }[] = [];
    const updated = devices.map((saved) => {
      const match = matchSavedToDiscovered(saved, discovered);
      // Do not change the address bound to an in-progress pairing transport.
      const next =
        match && this.pairingDevice?.id !== saved.id ? mergeIdentity(saved, match) : saved;
      if (identityChanged(saved, next)) changes.push({ previous: saved, next });
      return next;
    });
    if (changes.length) {
      for (const { previous, next } of changes) {
        // Migration can close provider transports. Never advertise a stale connection.
        if (this.activeDevice?.id === previous.id) await this.closeSessions();
        await this.provider(next).migrate?.(previous, next);
      }
      await writeDevices(updated);
    }
    await logInfo('adapter', 'TV scan complete', { count: discovered.length });
    return discovered;
  }

  saveDevice(draft: DeviceDraft): Promise<SavedDevice[]> {
    return this.transition(async () => {
      if (integrationEnvironment) assertLoopbackHost(draft.host);
      this.provider(draft);
      const devices = await readDevices();
      const existing = findExistingForDraft(draft, devices);
      if (existing && this.pairingDevice?.id === existing.id) {
        throw new Error('Cancel pairing before editing this device.');
      }
      const next = normalizeDraft(draft, existing);
      if (existing && identityChanged(existing, next)) {
        if (this.activeDevice?.id === existing.id) await this.closeSessions();
        await this.provider(next).migrate?.(existing, next);
      }
      const updated = [...devices.filter((item) => item.id !== existing?.id), next];
      await writeDevices(updated);
      if (this.activeDevice?.id === next.id) this.activeDevice = next;
      return updated;
    });
  }

  removeDevice(id: string): Promise<SavedDevice[]> {
    return this.transition(async () => {
      const devices = await readDevices();
      const device = devices.find((item) => item.id === id);
      if (device) {
        if (this.activeDevice?.id === id || this.pairingDevice?.id === id)
          await this.closeSessions();
        await this.provider(device).forget(device);
      }
      const updated = devices.filter((item) => item.id !== id);
      await writeDevices(updated);
      return updated;
    });
  }

  resetState(): Promise<DeviceState> {
    return this.transition(async () => {
      await this.closeSessions();
      for (const provider of this.providers.values()) await provider.reset();
      await clearDeviceStore();
      const legacyPaths = integrationEnvironment
        ? [getAppDataPath(), getAppDataPath('legacy', 'GTV Desktop Remote')]
        : [getAppDataPath(), path.join(app.getPath('appData'), 'GTV Desktop Remote')];
      for (const root of legacyPaths) {
        await fs.rm(path.join(root, 'devices.json'), { force: true });
        await fs.rm(path.join(root, 'androidtvremote'), { force: true, recursive: true });
      }
      this.deviceState = { ...DEFAULT_STATE, message: 'App state reset. Pair your devices again.' };
      return this.deviceState;
    });
  }

  startPairing(id: string): Promise<DeviceState> {
    return this.transition(async () => {
      const device = await this.savedDevice(id);
      await this.closeSessions();
      this.pairingDevice = device;
      try {
        const pairing = await this.provider(device).startPairing(device);
        await this.persistDevice(device);
        this.deviceState = { status: 'idle', message: pairing.instructions, pairing };
        return this.deviceState;
      } catch (error) {
        return this.failSession(error);
      }
    });
  }

  pair(request: PairingRequest): Promise<void> {
    return this.transition(async () => {
      const device = this.pairingDevice;
      if (
        !device ||
        (request.deviceId
          ? request.deviceId !== device.id
          : platformOf(device) !== 'google-tv' || request.host.trim() !== device.host)
      ) {
        throw new Error('Pairing request does not match the pending device.');
      }
      try {
        const pairing = await this.provider(device).pair(device, request.code.trim());
        if (pairing) {
          this.deviceState = { status: 'idle', message: pairing.instructions, pairing };
          return;
        }
        await this.persistDevice({ ...device, isPaired: true });
        this.pairingDevice = undefined;
        this.deviceState = { status: 'idle', message: 'Pairing succeeded. You can connect now.' };
      } catch (error) {
        await this.failSession(error);
      }
    });
  }

  connect(id: string): Promise<DeviceState> {
    return this.transition(async () => {
      const device = await this.savedDevice(id);
      await this.closeSessions();
      this.activeDevice = device;
      this.deviceState = {
        status: 'connecting',
        activeDeviceId: id,
        message: `Connecting to ${device.name}...`,
      };
      try {
        await this.provider(device).connect(device);
        device.lastConnectedAt = new Date().toISOString();
        await this.persistDevice(device);
        this.deviceState = {
          status: 'connected',
          activeDeviceId: id,
          message: `Connected to ${device.name}.`,
        };
        return this.deviceState;
      } catch (error) {
        return this.failSession(error);
      }
    });
  }

  private async persistDevice(device: SavedDevice): Promise<void> {
    const devices = await readDevices();
    await writeDevices(devices.map((item) => (item.id === device.id ? device : item)));
  }

  private async failSession(error: unknown): Promise<never> {
    try {
      await this.closeSessions();
    } catch (cleanupError) {
      await logError('adapter', 'TV session cleanup failed', cleanupError);
    }
    this.deviceState = {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    await logError('adapter', 'TV session failed', error);
    throw error;
  }

  disconnect(): Promise<DeviceState> {
    return this.transition(async () => {
      await this.closeSessions();
      this.deviceState = { status: 'idle', message: 'Disconnected.' };
      return this.deviceState;
    });
  }

  private connected(): SavedDevice {
    if (!this.activeDevice || this.deviceState.status !== 'connected')
      throw new Error('No active device connected.');
    return this.activeDevice;
  }

  async sendCommand(request: CommandDispatchRequest): Promise<void> {
    commandMetricsStore.recordAdapterDispatchStart(request, {
      deviceId: this.activeDevice?.id,
      host: this.activeDevice?.host,
    });
    try {
      const device = this.connected();
      const provider = this.provider(device);
      const capabilities = provider.capabilities;
      if (
        (capabilities.supportedCommands &&
          !capabilities.supportedCommands.includes(request.command)) ||
        (request.command === 'power' && !capabilities.powerToggle) ||
        (request.command.startsWith('assistant_') && capabilities.assistantVoice === false)
      ) {
        throw new Error(`Command ${request.command} is not supported by ${provider.name}.`);
      }
      await provider.sendCommand(device, request);
      commandMetricsStore.recordAdapterDispatchCompleted(request.id);
    } catch (error) {
      commandMetricsStore.recordCommandFailed(request, {
        reason: this.activeDevice ? 'send_failed' : 'no_active_device',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async sendText(text: string): Promise<void> {
    const device = this.connected();
    const provider = this.provider(device);
    if (!provider.capabilities.textInput)
      throw new Error(`Text input is not supported by ${provider.name}.`);
    await provider.sendText(device, text);
  }

  private voiceTarget() {
    const device = this.connected();
    const provider = this.provider(device);
    if (provider.capabilities.assistantVoice === false || !provider.voice) {
      throw new Error(`Assistant voice is not supported by ${provider.name}.`);
    }
    return { device, voice: provider.voice };
  }

  async startAssistantVoice(): Promise<number> {
    const { device, voice } = this.voiceTarget();
    return voice.start(device);
  }
  async sendAssistantVoiceChunk(sessionId: number, chunk: string): Promise<void> {
    const { device, voice } = this.voiceTarget();
    await voice.sendChunk(device, sessionId, chunk);
  }
  async stopAssistantVoice(sessionId: number): Promise<void> {
    const { device, voice } = this.voiceTarget();
    await voice.stop(device, sessionId);
  }
  async hasPendingAssistantVoiceSession(): Promise<boolean> {
    if (!this.activeDevice || this.deviceState.status !== 'connected') return false;
    const provider = this.provider(this.activeDevice);
    return provider.voice ? provider.voice.hasPending(this.activeDevice) : false;
  }
  getCapabilities(): Promise<DeviceCapabilities> {
    const device = this.activeDevice ?? this.pairingDevice;
    return Promise.resolve(device ? this.provider(device).capabilities : NO_CAPABILITIES);
  }
  async getBootstrapState(): Promise<BootstrapState> {
    return {
      devices: await readDevices(),
      deviceState: this.deviceState,
      providers: [...this.providers.values()].map(({ id, name, icon }) => ({ id, name, icon })),
    };
  }
}
