import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopApi } from '../shared/desktopApi';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../shared/ipcContract';
import type {
  BootstrapState,
  CommandDispatchRequest,
  CommandDropReport,
  CommandMetricsSnapshot,
  DeviceCapabilities,
  DeviceDraft,
  DeviceState,
  DiscoveredDevice,
  PairingRequest,
  SavedDevice,
  UpdaterStatus,
} from '../shared/types';

const api = {
  bootstrap: (): Promise<BootstrapState> => ipcRenderer.invoke(INVOKE_CHANNELS.deviceBootstrap),
  scanDevices: (): Promise<DiscoveredDevice[]> => ipcRenderer.invoke(INVOKE_CHANNELS.deviceScan),
  saveDevice: (draft: DeviceDraft): Promise<SavedDevice[]> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceSave, draft),
  removeDevice: (deviceId: string): Promise<SavedDevice[]> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceRemove, deviceId),
  resetState: (): Promise<DeviceState> => ipcRenderer.invoke(INVOKE_CHANNELS.deviceReset),
  startPairing: (deviceId: string): Promise<DeviceState> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceStartPairing, deviceId),
  pair: (request: PairingRequest): Promise<DeviceState> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.devicePair, request),
  connect: (deviceId: string): Promise<DeviceState> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceConnect, deviceId),
  disconnect: (): Promise<DeviceState> => ipcRenderer.invoke(INVOKE_CHANNELS.deviceDisconnect),
  sendCommand: (request: CommandDispatchRequest): Promise<void> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceCommand, request),
  recordCommandDrop: (report: CommandDropReport): Promise<void> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.metricsRendererDrop, report),
  getMetricsSnapshot: (): Promise<CommandMetricsSnapshot> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.metricsSnapshot),
  sendText: (text: string): Promise<void> => ipcRenderer.invoke(INVOKE_CHANNELS.deviceText, text),
  startAssistantVoice: (): Promise<number> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceAssistantVoiceStart),
  sendAssistantVoiceChunk: (sessionId: number, chunkBase64: string): Promise<void> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceAssistantVoiceChunk, sessionId, chunkBase64),
  stopAssistantVoice: (sessionId: number): Promise<void> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceAssistantVoiceStop, sessionId),
  hasPendingAssistantVoiceSession: (): Promise<boolean> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceAssistantVoicePending),
  capabilities: (): Promise<DeviceCapabilities> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.deviceCapabilities),
  checkForUpdates: (): Promise<UpdaterStatus> => ipcRenderer.invoke(INVOKE_CHANNELS.updaterCheck),
  checkForUpdatesInBackground: (): Promise<UpdaterStatus> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.updaterCheckBackground),
  getUpdaterStatus: (): Promise<UpdaterStatus> => ipcRenderer.invoke(INVOKE_CHANNELS.updaterStatus),
  installAvailableUpdate: (): Promise<UpdaterStatus> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.updaterInstall),
  rollbackToPreviousVersion: (): Promise<UpdaterStatus> =>
    ipcRenderer.invoke(INVOKE_CHANNELS.updaterRollback),
  /**
   * Subscribe to push-style updater status updates. The main process emits
   * `EVENT_CHANNELS.updaterStatusChanged` whenever the underlying state
   * changes; this replaces the prior 1.5s polling loop in the renderer
   * (QW-2). Returns an unsubscribe function — callers MUST call it on
   * unmount.
   */
  onUpdaterStatus: (listener: (status: UpdaterStatus) => void): (() => void) => {
    const wrapped = (_event: unknown, status: UpdaterStatus) => {
      listener(status);
    };
    ipcRenderer.on(EVENT_CHANNELS.updaterStatusChanged, wrapped);
    return () => {
      ipcRenderer.off(EVENT_CHANNELS.updaterStatusChanged, wrapped);
    };
  },
};

const typedApi: DesktopApi = api;

contextBridge.exposeInMainWorld('gtvRemote', typedApi);

export type { DesktopApi } from '../shared/desktopApi';
