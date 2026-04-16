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

export type RemoteCommandSource = 'keyboard' | 'button';

export type CommandDropReason =
  | 'renderer_burst_limit'
  | 'no_active_device'
  | 'connect_failed'
  | 'socket_destroyed'
  | 'socket_backpressure'
  | 'send_failed'
  | 'unknown';

export interface CommandDispatchRequest {
  id: string;
  command: RemoteCommand;
  issuedAt: number;
  source: RemoteCommandSource;
}

export interface CommandDropReport extends CommandDispatchRequest {
  droppedAt: number;
  dropReason: CommandDropReason;
  pendingCommandCount?: number;
}

export interface CommandMetricsRecord extends CommandDispatchRequest {
  updatedAt: number;
  status: 'pending' | 'sent' | 'dropped' | 'failed';
  lastStage:
    | 'renderer_dropped'
    | 'ipc_received'
    | 'adapter_dispatch_started'
    | 'adapter_dispatch_completed'
    | 'bridge_send_started'
    | 'connect_started'
    | 'connect_completed'
    | 'socket_write_completed'
    | 'socket_drained'
    | 'completed'
    | 'failed';
  deviceId?: string;
  host?: string;
  errorMessage?: string;
  dropReason?: CommandDropReason;
  pendingCommandCount?: number;
  ipcReceivedAt?: number;
  adapterDispatchStartedAt?: number;
  adapterDispatchCompletedAt?: number;
  bridgeSendStartedAt?: number;
  connectStartedAt?: number;
  connectCompletedAt?: number;
  socketWriteAt?: number;
  socketDrainedAt?: number;
  completedAt?: number;
  rendererDroppedAt?: number;
  socketWriteBuffered?: boolean;
}

export interface MetricsWarning {
  code: 'connect_stalled' | 'send_stalled' | 'backpressure' | 'no_inbound_activity';
  message: string;
  createdAt: number;
  host?: string;
  commandId?: string;
}

export interface CommandMetricsCounters {
  totalSubmitted: number;
  totalSucceeded: number;
  totalDropped: number;
  totalFailed: number;
  rendererDrops: number;
  backpressureEvents: number;
  connectAttempts: number;
  connectFailures: number;
  stallWarnings: number;
}

export interface CommandMetricsTransportSnapshot {
  socketState: 'disconnected' | 'connecting' | 'connected';
  currentHost?: string;
  pendingConnectHost?: string;
  pendingCommandId?: string;
  lastCommandIssuedAt?: number;
  lastConnectStartedAt?: number;
  lastConnectCompletedAt?: number;
  lastSuccessfulSendAt?: number;
  lastInboundMessageAt?: number;
  lastSocketDrainAt?: number;
  consecutiveSendFailures: number;
  backpressureEvents: number;
}

export interface CommandMetricsSnapshot {
  generatedAt: number;
  counters: CommandMetricsCounters;
  transport: CommandMetricsTransportSnapshot;
  warnings: MetricsWarning[];
  recentCommands: CommandMetricsRecord[];
}

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
  sendCommand(request: CommandDispatchRequest): Promise<void>;
  sendText(text: string): Promise<void>;
  getCapabilities(): Promise<DeviceCapabilities>;
  getBootstrapState(): Promise<BootstrapState>;
}