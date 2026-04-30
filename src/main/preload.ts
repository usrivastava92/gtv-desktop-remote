import { contextBridge, ipcRenderer } from 'electron';

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
} from '../shared/types';

const api = {
  bootstrap: (): Promise<BootstrapState> => ipcRenderer.invoke('device:bootstrap'),
  scanDevices: (): Promise<DiscoveredDevice[]> => ipcRenderer.invoke('device:scan'),
  saveDevice: (draft: DeviceDraft): Promise<SavedDevice[]> =>
    ipcRenderer.invoke('device:save', draft),
  removeDevice: (deviceId: string): Promise<SavedDevice[]> =>
    ipcRenderer.invoke('device:remove', deviceId),
  resetState: (): Promise<DeviceState> => ipcRenderer.invoke('device:reset'),
  startPairing: (deviceId: string): Promise<DeviceState> =>
    ipcRenderer.invoke('device:startPairing', deviceId),
  pair: (request: PairingRequest): Promise<DeviceState> =>
    ipcRenderer.invoke('device:pair', request),
  connect: (deviceId: string): Promise<DeviceState> =>
    ipcRenderer.invoke('device:connect', deviceId),
  disconnect: (): Promise<DeviceState> => ipcRenderer.invoke('device:disconnect'),
  sendCommand: (request: CommandDispatchRequest): Promise<void> =>
    ipcRenderer.invoke('device:command', request),
  recordCommandDrop: (report: CommandDropReport): Promise<void> =>
    ipcRenderer.invoke('metrics:rendererDrop', report),
  getMetricsSnapshot: (): Promise<CommandMetricsSnapshot> => ipcRenderer.invoke('metrics:snapshot'),
  sendText: (text: string): Promise<void> => ipcRenderer.invoke('device:text', text),
  capabilities: (): Promise<DeviceCapabilities> => ipcRenderer.invoke('device:capabilities'),
};

contextBridge.exposeInMainWorld('gtvRemote', api);

export type DesktopApi = typeof api;
