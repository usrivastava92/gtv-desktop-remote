import type {
  AppleTvCredentials,
  AppleTvDevice,
  AppleTvPairingSession,
} from '@librecontrol/apple-tv' with {
  'resolution-mode': 'import',
};

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

// Node16 emits native import() for this ESM-only protocol library.
function loadAppleLibrary() {
  return import('@librecontrol/apple-tv');
}

type AppleClient = AppleTvDevice;
type ApplePairing = AppleTvPairingSession;
const COMMANDS: Partial<Record<RemoteCommand, string>> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  select: 'select',
  home: 'home',
  home_hold: 'homeHold',
  back: 'menu',
  play_pause: 'playPause',
  volume_up: 'volumeUp',
  volume_down: 'volumeDown',
  power: 'power',
};

const AIRPLAY_PIN: PairingStep = {
  instructions:
    'Enter the four-digit AirPlay PIN shown on your Apple TV. A second PIN will follow for Companion pairing.',
  codeLength: 4,
  inputPattern: '[0-9]',
};
const COMPANION_PIN: PairingStep = {
  instructions:
    'AirPlay paired. Enter the NEW four-digit PIN shown on your Apple TV. Afterwards, macOS may ask permission to save pairing in Keychain.',
  codeLength: 4,
  inputPattern: '[0-9]',
};

export class AppleTvProvider implements TvProvider {
  readonly id = 'apple-tv';
  readonly name = 'Apple TV';
  readonly icon = 'apple' as const;
  readonly capabilities: DeviceCapabilities = {
    textInput: true,
    powerToggle: true,
    assistantVoice: false,
    supportedCommands: Object.keys(COMMANDS) as RemoteCommand[],
  };

  private readonly clients = new Map<
    string,
    {
      client: AppleClient;
      pairing?: ApplePairing;
      connected: boolean;
    }
  >();

  async discover(): Promise<DiscoveredDevice[]> {
    const { discoverAppleTv } = await loadAppleLibrary();
    return (await discoverAppleTv()).map((device) => ({
      id: `${this.id}:${device.identifier ?? device.id}`,
      platform: this.id,
      source: 'apple-tv',
      name: device.name,
      host: device.host,
      model: device.model,
      remotePort: device.port,
      providerData: {
        identifier: device.identifier ?? device.id,
        ...(device.port !== undefined ? { port: device.port } : {}),
      },
    }));
  }

  private async createClient(
    device: SavedDevice,
    credentials?: AppleTvCredentials
  ): Promise<AppleClient> {
    const { createAppleTv } = await loadAppleLibrary();
    return createAppleTv({
      id: device.id,
      name: device.name,
      host: device.host,
      identifier:
        typeof device.providerData?.identifier === 'string'
          ? device.providerData.identifier
          : undefined,
      credentials,
    });
  }

  async startPairing(device: SavedDevice): Promise<PairingStep> {
    await this.disconnect(device);
    const client = await this.createClient(device);
    try {
      const pairing = await client.startPairing();
      this.clients.set(device.id, { client, pairing, connected: false });
      return { ...AIRPLAY_PIN };
    } catch (error) {
      await client.disconnect();
      throw error;
    }
  }

  async pair(device: SavedDevice, code: string): Promise<PairingStep | undefined> {
    const entry = this.clients.get(device.id);
    if (!entry?.pairing) throw new Error('Start Apple TV pairing before entering the PIN.');
    if (!/^\d{4}$/.test(code)) throw new Error('Enter the four-digit PIN shown on your Apple TV.');
    const result = await entry.pairing.submitCode(code);
    if (result.status === 'awaiting-next-pin' && result.nextProtocol === 'companion') {
      return { ...COMPANION_PIN };
    }
    if (
      !result.paired ||
      result.status !== 'ok' ||
      !result.credentials?.airplay ||
      !result.credentials.companion
    ) {
      // Preserve the protocol result: transport/auth failures must not look identical.
      const stage = result.currentProtocol ?? 'unknown stage';
      const detail = result.message ?? 'The library returned incomplete pairing credentials.';
      const error = new Error(`Apple TV ${stage} pairing failed (${result.status}): ${detail}`);
      try {
        await this.disconnect(device);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], error.message, { cause: cleanupError });
      }
      throw error;
    }
    await providerCredentials.write(this.id, device.id, result.credentials);
    await this.disconnect(device);
    return undefined;
  }

  async connect(device: SavedDevice): Promise<void> {
    await this.disconnect(device);
    const credentials = await providerCredentials.read(this.id, device.id);
    if (!credentials?.airplay || !credentials.companion) {
      throw new Error('Pair this Apple TV and complete both PIN steps before connecting.');
    }
    const client = await this.createClient(device, credentials);
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
    if (!key) throw new Error('This command is not supported by Apple TV.');
    const entry = this.clients.get(device.id);
    if (!entry?.connected) throw new Error('Apple TV is not connected.');
    await entry.client.sendKey(key);
    commandMetricsStore.recordCommandSucceeded(request.id);
  }

  async sendText(device: SavedDevice, text: string): Promise<void> {
    const entry = this.clients.get(device.id);
    if (!entry?.connected) throw new Error('Apple TV is not connected.');
    // The native text API silently does nothing without a keyboard session.
    if ((await entry.client.getText()) === undefined) {
      throw new Error('Focus a text field on your Apple TV before sending text.');
    }
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
