import fs from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray } from 'electron';

import type { DeviceDraft, PairingRequest, RemoteCommand } from '../shared/types';
import { GoogleTvAdapter } from './device/googleTvAdapter';
import { getLoggerPath, logError, logInfo } from './logger';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

let tray: Tray | undefined;
let windowRef: BrowserWindow | undefined;

const adapter = new GoogleTvAdapter();
const appName = 'GTV Remote';
const shortcut = 'CommandOrControl+Shift+G';

function getAssetPath(...parts: string[]) {
  return path.join(app.getAppPath(), 'assets', 'icons', ...parts);
}

function loadSvgIcon(size: number) {
  const svg = fs.readFileSync(getAssetPath('gtv-remote-icon.svg'), 'utf8');
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

  return image.resize({ width: size, height: size });
}

function loadPngIcon(size: number) {
  const iconPath = getAssetPath('taskbar-icon-black.png');
  const image = nativeImage.createFromPath(iconPath);

  return image.resize({ width: size, height: size, quality: 'best' });
}

function loadMenubarIcon(size: number) {
  const image = nativeImage.createFromPath(getAssetPath('menubar-icon-white.png'));

  return image.resize({ height: size, quality: 'best' });
}

function createTrayImage() {
  const trayImage = loadMenubarIcon(18);

  if (process.platform === 'darwin') {
    trayImage.setTemplateImage(true);
  }

  return trayImage;
}

function applyApplicationIcon() {
  const iconImage = loadPngIcon(256);

  if (process.platform === 'darwin') {
    app.dock?.setIcon(iconImage);
  }

  return iconImage;
}

async function createWindow(): Promise<BrowserWindow> {
  const iconImage = applyApplicationIcon();
  const window = new BrowserWindow({
    width: 420,
    height: 760,
    show: false,
    resizable: false,
    title: appName,
    icon: iconImage,
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
  tray.setToolTip(appName);
  tray.setContextMenu(buildContextMenu());
  tray.on('click', toggleWindow);

  globalShortcut.register(shortcut, toggleWindow);
  await logInfo('main', 'Application bootstrap complete', { shortcut, logPath: getLoggerPath() });
}

app.setName(appName);
process.title = appName;

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