import type {
  CommandDispatchRequest,
  DeviceCapabilities,
  DiscoveredDevice,
  PairingStep,
  ProviderIcon,
  SavedDevice,
} from '../../shared/types';

export interface TvProvider {
  readonly id: string;
  readonly name: string;
  readonly icon?: ProviderIcon;
  readonly capabilities: DeviceCapabilities;
  discover(): Promise<DiscoveredDevice[]>;
  startPairing(device: SavedDevice): Promise<PairingStep>;
  pair(device: SavedDevice, code: string): Promise<PairingStep | undefined>;
  connect(device: SavedDevice): Promise<void>;
  disconnect(device: SavedDevice): Promise<void>;
  sendCommand(device: SavedDevice, request: CommandDispatchRequest): Promise<void>;
  sendText(device: SavedDevice, text: string): Promise<void>;
  forget(device: SavedDevice): Promise<void>;
  reset(): Promise<void>;
  migrate?(previous: SavedDevice, next: SavedDevice): Promise<void>;
  voice?: {
    start(device: SavedDevice): Promise<number>;
    sendChunk(device: SavedDevice, sessionId: number, chunkBase64: string): Promise<void>;
    stop(device: SavedDevice, sessionId: number): Promise<void>;
    hasPending(device: SavedDevice): Promise<boolean>;
  };
}
