import path from 'node:path';

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray } from 'electron';

import type { DeviceDraft, PairingRequest, RemoteCommand } from '../shared/types';
import { GoogleTvAdapter } from './device/googleTvAdapter';
import { getLoggerPath, logError, logInfo } from './logger';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

let tray: Tray | undefined;
let windowRef: BrowserWindow | undefined;

const adapter = new GoogleTvAdapter();
const shortcut = 'CommandOrControl+Shift+G';

function createTrayImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <rect x="2" y="2" width="14" height="14" rx="4" fill="#20242b"/>
      <circle cx="9" cy="6" r="1.2" fill="#f6f4ef"/>
      <circle cx="9" cy="12" r="1.2" fill="#f6f4ef"/>
      <circle cx="6" cy="9" r="1.2" fill="#f6f4ef"/>
      <circle cx="12" cy="9" r="1.2" fill="#f6f4ef"/>
      <circle cx="9" cy="9" r="1.4" fill="#d5a021"/>
    </svg>
  `;

  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 420,
    height: 760,
    show: false,
    resizable: false,
    title: 'GTV Desktop Remote',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (app.isPackaged) {
    await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    await window.loadURL('http://localhost:5173');
  }

  window.on('blur', () => {
    if (!window.webContents.isDevToolsOpened()) {
      window.hide();
    }
  });

  return window;
}

function toggleWindow() {
  if (!windowRef) {
    return;
  }

  if (windowRef.isVisible()) {
    windowRef.hide();
    return;
  }

  windowRef.show();
  windowRef.focus();
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show Remote', click: () => windowRef?.show() },
    { label: 'Hide Remote', click: () => windowRef?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

async function bootstrapApp() {
  windowRef = await createWindow();
  windowRef.show();
  windowRef.focus();
  tray = new Tray(createTrayImage());
  tray.setToolTip('GTV Desktop Remote');
  tray.setContextMenu(buildContextMenu());
  tray.on('click', toggleWindow);

  globalShortcut.register(shortcut, toggleWindow);
  await logInfo('main', 'Application bootstrap complete', { shortcut, logPath: getLoggerPath() });
}

function registerIpc() {
  ipcMain.handle('device:bootstrap', async () => adapter.getBootstrapState());
  ipcMain.handle('device:scan', async () => adapter.scanForDevices());
  ipcMain.handle('device:save', async (_event, draft: DeviceDraft) => adapter.saveDevice(draft));
  ipcMain.handle('device:remove', async (_event, deviceId: string) => adapter.removeDevice(deviceId));
  ipcMain.handle('device:startPairing', async (_event, deviceId: string) => adapter.startPairing(deviceId));
  ipcMain.handle('device:pair', async (_event, request: PairingRequest) => adapter.pair(request));
  ipcMain.handle('device:connect', async (_event, deviceId: string) => adapter.connect(deviceId));
  ipcMain.handle('device:disconnect', async () => adapter.disconnect());
  ipcMain.handle('device:command', async (_event, command: RemoteCommand) => adapter.sendCommand(command));
  ipcMain.handle('device:text', async (_event, text: string) => adapter.sendText(text));
  ipcMain.handle('device:capabilities', async () => adapter.getCapabilities());
}

app.whenReady().then(async () => {
  registerIpc();
  await bootstrapApp();
});

process.on('uncaughtException', (error) => {
  void logError('main', 'Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  void logError('main', 'Unhandled rejection', reason);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep the app alive in the menu bar.
});