export type RemoteCommand =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'select'
  | 'home'
  | 'back'
  | 'play_pause'
  | 'volume_up'
  | 'volume_down'
  | 'power';

export interface SavedDevice {
  id: string;
  name: string;
  host: string;
  isPaired?: boolean;
  adbPort?: number;
  pairingPort?: number;
  macAddress?: string;
  lastConnectedAt?: string;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  host: string;
  adbPort?: number;
  pairingPort?: number;
  remotePort?: number;
  macAddress?: string;
  model?: string;
  source: 'googlecast' | 'adb' | 'androidtvremote';
}

export interface PairingRequest {
  deviceId?: string;
  host: string;
  code: string;
}

export interface DeviceDraft {
  name: string;
  host: string;
  adbPort: number;
  pairingPort?: number;
}

export interface DeviceState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  message: string;
  activeDeviceId?: string;
}

export interface BootstrapState {
  devices: SavedDevice[];
  deviceState: DeviceState;
}

export interface DeviceCapabilities {
  textInput: boolean;
  powerToggle: boolean;
}

export interface DeviceAdapter {
  listDevices(): Promise<SavedDevice[]>;
  scanForDevices(): Promise<DiscoveredDevice[]>;
  saveDevice(draft: DeviceDraft): Promise<SavedDevice[]>;
  removeDevice(deviceId: string): Promise<SavedDevice[]>;
  resetState(): Promise<DeviceState>;
  startPairing(deviceId: string): Promise<DeviceState>;
  pair(request: PairingRequest): Promise<void>;
  connect(deviceId: string): Promise<DeviceState>;
  disconnect(): Promise<DeviceState>;
  sendCommand(command: RemoteCommand): Promise<void>;
  sendText(text: string): Promise<void>;
  getCapabilities(): Promise<DeviceCapabilities>;
  getBootstrapState(): Promise<BootstrapState>;
}