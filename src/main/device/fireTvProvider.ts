import type {
  FireTvDevice,
  FireTvKeyName,
  FireTvPairingSession,
} from '@librecontrol/fire-tv' with { 'resolution-mode': 'import' };

import type {
  CommandDispatchRequest,
  DeviceCapabilities,
  DiscoveredDevice,
  PairingStep,
  RemoteCommand,
  SavedDevice,
} from '../../shared/types';
import { commandMetricsStore } from '../metrics';

import { providerCredentials } from './providerCredentials';
import type { TvProvider } from './tvProvider';

const COMMANDS: Partial<Record<RemoteCommand, FireTvKeyName>> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  select: 'select',
  home: 'home',
  back: 'back',
  play_pause: 'playPause',
  power: 'powerToggle',
};

export class FireTvProvider implements TvProvider {
  readonly id = 'fire-tv';
  readonly name = 'Fire TV';
  readonly icon = 'fire-tv' as const;
  readonly capabilities: DeviceCapabilities = {
    textInput: true,
    powerToggle: true,
    assistantVoice: false,
    supportedCommands: Object.keys(COMMANDS) as RemoteCommand[],
  };

  private readonly clients = new Map<
    string,
    {
      client: FireTvDevice;
      pairing?: FireTvPairingSession;
      connected: boolean;
    }
  >();

  // Native import() is required: this ESM-only library cannot be require()d by Electron's CommonJS main.
  async discover(): Promise<DiscoveredDevice[]> {
    const { discoverFireTv } = await import('@librecontrol/fire-tv');
    return (await discoverFireTv()).map((device) => ({
      id: `${this.id}:${device.id}`,
      platform: this.id,
      source: 'fire-tv',
      name: device.name,
      host: device.host,
      remotePort: device.port,
      providerData: {
        identifier: device.id,
        port: device.port,
        serviceName: device.serviceName,
      },
    }));
  }

  private async createClient(device: SavedDevice): Promise<FireTvDevice> {
    const credentials = await providerCredentials.read(this.id, device.id);
    if (credentials && !credentials.clientToken) {
      throw new Error('Fire TV credentials are incomplete. Forget this TV and pair it again.');
    }
    const data = device.providerData;
    if (data?.protocol !== undefined && data.protocol !== 'http' && data.protocol !== 'https') {
      throw new Error('Invalid Fire TV protocol.');
    }
    const { createFireTv } = await import('@librecontrol/fire-tv');
    return createFireTv({
      id: device.id,
      name: device.name,
      host: device.host,
      port: typeof data?.port === 'number' ? data.port : undefined,
      dialPort: typeof data?.dialPort === 'number' ? data.dialPort : undefined,
      protocol: data?.protocol,
      // Self-signed receiver certificates are normal; never fall back to plaintext HTTP.
      rejectUnauthorized: data?.rejectUnauthorized === 1,
      clientToken: credentials?.clientToken,
    });
  }

  async startPairing(device: SavedDevice): Promise<PairingStep> {
    providerCredentials.assertAvailable();
    await this.disconnect(device);
    const client = await this.createClient(device);
    try {
      const pairing = await client.startPairing();
      this.clients.set(device.id, { client, pairing, connected: false });
      return {
        instructions: 'Enter the four-digit PIN shown on your Fire TV.',
        codeLength: 4,
        inputPattern: '[0-9]',
      };
    } catch (error) {
      await client.disconnect();
      throw error;
    }
  }

  async pair(device: SavedDevice, code: string): Promise<PairingStep | undefined> {
    const entry = this.clients.get(device.id);
    if (!entry?.pairing) throw new Error('Start Fire TV pairing before entering the PIN.');
    if (!/^\d{4}$/.test(code)) throw new Error('Enter the four-digit PIN shown on your Fire TV.');
    const result = await entry.pairing.submitCode(code);
    if (!result.paired || result.status !== 'ok' || !result.credentials?.clientToken) {
      throw new Error(
        'Fire TV pairing failed. Request a new code and enter the PIN shown on screen.'
      );
    }
    await providerCredentials.write(this.id, device.id, {
      clientToken: result.credentials.clientToken,
    });
    await this.disconnect(device);
    return undefined;
  }

  async connect(device: SavedDevice): Promise<void> {
    await this.disconnect(device);
    const client = await this.createClient(device);
    try {
      await client.connect();
      this.clients.set(device.id, { client, connected: true });
    } catch (error) {
      await client.disconnect();
      throw error;
    }
  }

  async disconnect(device: SavedDevice): Promise<void> {
    const entry = this.clients.get(device.id);
    this.clients.delete(device.id);
    if (!entry) return;
    try {
      await entry.pairing?.close();
    } finally {
      await entry.client.disconnect();
    }
  }

  async sendCommand(device: SavedDevice, request: CommandDispatchRequest): Promise<void> {
    const key = COMMANDS[request.command];
    if (!key) throw new Error('This command is not supported by Fire TV.');
    const entry = this.clients.get(device.id);
    if (!entry?.connected) throw new Error('Fire TV is not connected.');
    await entry.client.sendKey(key);
    commandMetricsStore.recordCommandSucceeded(request.id);
  }

  async sendText(device: SavedDevice, text: string): Promise<void> {
    const entry = this.clients.get(device.id);
    if (!entry?.connected) throw new Error('Fire TV is not connected.');
    await entry.client.inputText(text);
  }

  async forget(device: SavedDevice): Promise<void> {
    try {
      await this.disconnect(device);
    } finally {
      await providerCredentials.remove(this.id, device.id);
    }
  }

  async reset(): Promise<void> {
    const outcomes = await Promise.allSettled(
      [...this.clients.keys()].map((id) => this.disconnect({ id } as SavedDevice))
    );
    await providerCredentials.clear(this.id);
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  async migrate(previous: SavedDevice, next: SavedDevice): Promise<void> {
    await this.disconnect(previous);
    if (previous.id !== next.id) {
      const credentials = await providerCredentials.read(this.id, previous.id);
      if (credentials) await providerCredentials.write(this.id, next.id, credentials);
      await providerCredentials.remove(this.id, previous.id);
    }
  }
}
