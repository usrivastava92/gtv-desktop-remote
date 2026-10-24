import { createSystemClock } from '../../backend/core/clock';
import { VoiceSessionService } from '../../backend/voice/VoiceSessionService';
import type { CommandDispatchRequest, PairingStep, SavedDevice } from '../../shared/types';
import { createNodeLogger } from '../logger';

import { androidTvRemoteBridge, GOOGLE_TV_SUPPORTED_COMMANDS } from './androidTvRemote';
import { discoverGoogleTvDevices } from './discovery';
import type { TvProvider } from './tvProvider';

function voiceTarget(device: SavedDevice) {
  return { deviceId: device.id, host: device.host, macAddress: device.macAddress };
}

export class GoogleTvProvider implements TvProvider {
  readonly id = 'google-tv';
  readonly name = 'Google TV / Android TV';
  readonly icon = 'assistant' as const;
  readonly capabilities = {
    textInput: true,
    powerToggle: true,
    assistantVoice: true,
    supportedCommands: GOOGLE_TV_SUPPORTED_COMMANDS,
  };
  private readonly voiceSessions: VoiceSessionService;

  constructor(voiceSessions?: VoiceSessionService) {
    this.voiceSessions =
      voiceSessions ??
      new VoiceSessionService(
        {
          start: (host, mac) => androidTvRemoteBridge.startAssistantVoice(host, mac),
          sendChunk: (host, sessionId, chunk, mac) =>
            androidTvRemoteBridge.sendAssistantVoiceChunk(host, sessionId, chunk, mac),
          stop: (host, sessionId, mac) =>
            androidTvRemoteBridge.stopAssistantVoice(host, sessionId, mac),
          hasPending: (host, mac) =>
            androidTvRemoteBridge.hasPendingAssistantVoiceSession(host, mac),
        },
        createSystemClock(),
        createNodeLogger()
      );
  }

  async discover() {
    return (await discoverGoogleTvDevices()).map((device) => ({ ...device, platform: this.id }));
  }

  async startPairing(device: SavedDevice): Promise<PairingStep> {
    const result = await androidTvRemoteBridge.startPairing(device.host, device.macAddress);
    if (typeof result?.mac === 'string') device.macAddress = result.mac;
    return {
      instructions: `Enter the 6-digit code shown on ${device.name}.`,
      codeLength: 6,
      inputPattern: '[0-9A-Fa-f]',
    };
  }

  async pair(device: SavedDevice, code: string): Promise<undefined> {
    await androidTvRemoteBridge.finishPairing(device.host, code, device.macAddress);
    return undefined;
  }

  async connect(device: SavedDevice): Promise<void> {
    const result = await androidTvRemoteBridge.connect(device.host, device.macAddress);
    if (typeof result?.mac === 'string') device.macAddress = result.mac;
  }

  async disconnect(device: SavedDevice): Promise<void> {
    androidTvRemoteBridge.disconnect(device.host);
    await androidTvRemoteBridge.cancelPairing(device.host);
  }

  async sendCommand(device: SavedDevice, request: CommandDispatchRequest): Promise<void> {
    if (!this.capabilities.supportedCommands.includes(request.command)) {
      throw new Error('This command is not supported by Google TV.');
    }
    await androidTvRemoteBridge.sendCommand(device.host, request, device.macAddress);
  }

  async sendText(device: SavedDevice, text: string): Promise<void> {
    await androidTvRemoteBridge.sendText(device.host, text, device.macAddress);
  }

  async forget(device: SavedDevice): Promise<void> {
    await androidTvRemoteBridge.forgetDevice(device.host, device.macAddress);
  }

  async reset(): Promise<void> {
    await androidTvRemoteBridge.reset();
  }

  async migrate(previous: SavedDevice, next: SavedDevice): Promise<void> {
    if (next.macAddress) {
      await androidTvRemoteBridge.migrateCerts(previous.host, next.macAddress);
    } else if (previous.host !== next.host) {
      await androidTvRemoteBridge.migratePersistedCerts(previous.host, next.host);
    }
  }

  readonly voice = {
    start: (device: SavedDevice) => this.voiceSessions.start(voiceTarget(device)),
    sendChunk: (device: SavedDevice, sessionId: number, chunk: string) =>
      this.voiceSessions.sendChunk(voiceTarget(device), sessionId, chunk),
    stop: (device: SavedDevice, sessionId: number) =>
      this.voiceSessions.stop(voiceTarget(device), sessionId),
    hasPending: (device: SavedDevice) => this.voiceSessions.hasPending(voiceTarget(device)),
  };
}
