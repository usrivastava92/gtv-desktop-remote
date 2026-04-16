import { contextBridge, ipcRenderer } from 'electron';

import type {
    CommandDispatchRequest,
    CommandDropReport,
    DeviceDraft,
    PairingRequest,
} from '../shared/types';

const api = {
  bootstrap: () => ipcRenderer.invoke('device:bootstrap'),
  scanDevices: () => ipcRenderer.invoke('device:scan'),
  saveDevice: (draft: DeviceDraft) => ipcRenderer.invoke('device:save', draft),
  removeDevice: (deviceId: string) => ipcRenderer.invoke('device:remove', deviceId),
  resetState: () => ipcRenderer.invoke('device:reset'),
  startPairing: (deviceId: string) => ipcRenderer.invoke('device:startPairing', deviceId),
  pair: (request: PairingRequest) => ipcRenderer.invoke('device:pair', request),
  connect: (deviceId: string) => ipcRenderer.invoke('device:connect', deviceId),
  disconnect: () => ipcRenderer.invoke('device:disconnect'),
  sendCommand: (request: CommandDispatchRequest) => ipcRenderer.invoke('device:command', request),
  recordCommandDrop: (report: CommandDropReport) => ipcRenderer.invoke('metrics:rendererDrop', report),
  getMetricsSnapshot: () => ipcRenderer.invoke('metrics:snapshot'),
  sendText: (text: string) => ipcRenderer.invoke('device:text', text),
  capabilities: () => ipcRenderer.invoke('device:capabilities')
};

contextBridge.exposeInMainWorld('gtvRemote', api);

export type DesktopApi = typeof api;