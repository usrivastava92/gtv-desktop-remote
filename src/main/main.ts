import fs from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray } from 'electron';

import type { CommandDispatchRequest, CommandDropReport, DeviceDraft, PairingRequest } from '../shared/types';
import { GoogleTvAdapter } from './device/googleTvAdapter';
import { getLoggerPath, logError, logInfo } from './logger';
import { commandMetricsStore } from './metrics';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

let tray: Tray | undefined;
let windowRef: BrowserWindow | undefined;

const adapter = new GoogleTvAdapter();
const appName = 'GTV Remote';
const shortcut = 'CommandOrControl+Shift+G';

function getAssetPath(...parts: string[]) {
  return path.join(app.getAppPath(), 'assets', 'icons', ...parts);
}

function getRendererEntryPath() {
  return path.join(app.getAppPath(), 'dist', 'index.html');
}

function loadSvgIcon(size: number) {
  const svg = fs.readFileSync(getAssetPath('gtv-remote-icon.svg'), 'utf8');
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

  return image.resize({ width: size, height: size });
}

function loadPngIcon(size: number) {
  const iconPath = getAssetPath('taskbar-icon.png');
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

function attachWindowDiagnostics(window: BrowserWindow) {
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    void logError('renderer', 'Window failed to load', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    });
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    void logError('renderer', 'Render process exited unexpectedly', details);
  });

  window.webContents.on('unresponsive', () => {
    void logError('renderer', 'Window became unresponsive');
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const logger = level >= 2 ? logError : logInfo;
    void logger('renderer-console', message, { level, line, sourceId });
  });
}

async function createWindow(): Promise<BrowserWindow> {
  const iconImage = applyApplicationIcon();
  const window = new BrowserWindow({
    width: 360,
    height: 720,
    useContentSize: true,
    show: false,
    resizable: false,
    title: appName,
    icon: iconImage,
    backgroundColor: '#0b0b0b',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(false);
  }

  attachWindowDiagnostics(window);

  if (app.isPackaged) {
    await window.loadFile(getRendererEntryPath());
  } else {
    await window.loadURL('http://localhost:5173');
  }

  window.on('blur', () => {
    if (!window.webContents.isDevToolsOpened()) {
      window.hide();
    }
  });

  window.on('closed', () => {
    if (windowRef === window) {
      windowRef = undefined;
    }
  });

  return window;
}

async function ensureWindow(): Promise<BrowserWindow> {
  if (windowRef && !windowRef.isDestroyed()) {
    return windowRef;
  }

  windowRef = await createWindow();
  return windowRef;
}

async function showWindow() {
  const window = await ensureWindow();
  window.show();
  window.focus();
}

async function hideWindow() {
  if (!windowRef || windowRef.isDestroyed()) {
    return;
  }

  windowRef.hide();
}

async function toggleWindow() {
  const window = await ensureWindow();

  if (window.isVisible()) {
    window.hide();
    return;
  }

  window.show();
  window.focus();
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show Remote', click: () => void showWindow() },
    { label: 'Hide Remote', click: () => void hideWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

async function bootstrapApp() {
  windowRef = await createWindow();
  await showWindow();
  tray = new Tray(createTrayImage());
  tray.setToolTip(appName);
  tray.setContextMenu(buildContextMenu());
  tray.on('click', () => void toggleWindow());

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
  ipcMain.handle('device:reset', async () => adapter.resetState());
  ipcMain.handle('device:startPairing', async (_event, deviceId: string) => adapter.startPairing(deviceId));
  ipcMain.handle('device:pair', async (_event, request: PairingRequest) => adapter.pair(request));
  ipcMain.handle('device:connect', async (_event, deviceId: string) => adapter.connect(deviceId));
  ipcMain.handle('device:disconnect', async () => adapter.disconnect());
  ipcMain.handle('device:command', async (_event, request: CommandDispatchRequest) => {
    commandMetricsStore.recordIpcReceived(request);
    return adapter.sendCommand(request);
  });
  ipcMain.handle('metrics:rendererDrop', async (_event, report: CommandDropReport) => {
    commandMetricsStore.recordRendererDrop(report);
  });
  ipcMain.handle('metrics:snapshot', async () => commandMetricsStore.getSnapshot());
  ipcMain.handle('device:text', async (_event, text: string) => adapter.sendText(text));
  ipcMain.handle('device:capabilities', async () => adapter.getCapabilities());
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    await bootstrapApp();
  } catch (error) {
    await logError('main', 'Application bootstrap failed', error);
    throw error;
  }
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