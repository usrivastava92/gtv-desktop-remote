import fs from 'node:fs';
import path from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  systemPreferences,
  Tray,
} from 'electron';

import { INVOKE_CHANNELS } from '../shared/ipcContract';
import type {
  CommandDispatchRequest,
  CommandDropReport,
  DeviceDraft,
  PairingRequest,
  UpdaterStatus,
} from '../shared/types';

import { captureIpc, closeCapture, initCapture } from './capture';
import { GoogleTvAdapter } from './device/googleTvAdapter';
import { getLoggerPath, logError, logInfo } from './logger';
import { commandMetricsStore } from './metrics';
import {
  checkForUpdatesInBackground,
  checkForUpdatesManually,
  getUpdaterStatus,
  installAvailableUpdate,
  rollbackToPreviousVersion,
  subscribeUpdaterStatus,
} from './updater';

declare const _MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

let tray: Tray | undefined;
let windowRef: BrowserWindow | undefined;

const adapter = new GoogleTvAdapter();
const appName = 'GTV Remote';
const shortcut = 'CommandOrControl+Shift+G';
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function getAssetPath(...parts: string[]) {
  return path.join(app.getAppPath(), 'assets', 'icons', ...parts);
}

function getRendererEntryPath() {
  return path.join(app.getAppPath(), 'dist', 'index.html');
}

function _loadSvgIcon(size: number) {
  const svg = fs.readFileSync(getAssetPath('gtv-remote-icon.svg'), 'utf8');
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );

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
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      void logError('renderer', 'Window failed to load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    }
  );

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
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(false);
  }
  window.setSkipTaskbar(true);

  attachWindowDiagnostics(window);

  const unsubscribeUpdater = subscribeUpdaterStatus((status) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send('updater:statusChanged', status);
  });

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
    unsubscribeUpdater();
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
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
  window.focus();
}

function hideWindow() {
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

  await showWindow();
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Show Remote',
      click: () => {
        void showWindow();
      },
    },
    {
      label: 'Hide Remote',
      click: () => {
        hideWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates…',
      click: () => {
        void handleManualUpdateCheckFromMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);
}

function buildApplicationMenu() {
  if (process.platform !== 'darwin') {
    return;
  }

  const appMenu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        {
          label: 'About GTV Remote',
          role: 'about',
        },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => {
            void handleManualUpdateCheckFromMenu();
          },
        },
        { type: 'separator' },
        {
          label: 'Hide GTV Remote',
          role: 'hide',
        },
        {
          label: 'Hide Others',
          role: 'hideOthers',
        },
        { type: 'separator' },
        {
          label: 'Quit GTV Remote',
          role: 'quit',
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]);

  Menu.setApplicationMenu(appMenu);
}

async function showUpdaterResultDialog(status: UpdaterStatus) {
  if (status.stage === 'failed') {
    await dialog.showMessageBox({
      type: 'warning',
      buttons: ['OK'],
      defaultId: 0,
      title: 'Update Check',
      message: status.message,
    });
    return;
  }

  if (status.updateInstallable) {
    const choice = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Update now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      icon: loadPngIcon(128),
      title: 'Update Available',
      message: `Version ${status.latestVersion ?? 'unknown'} is available.`,
      detail: 'Install now or update later.',
    });

    if (choice.response === 0) {
      await installAvailableUpdate();
    }

    return;
  }

  await dialog.showMessageBox({
    type: 'info',
    buttons: ['OK'],
    defaultId: 0,
    title: 'Update Check',
    message: status.message,
  });
}

async function handleManualUpdateCheckFromMenu() {
  const status = await checkForUpdatesManually();
  await showUpdaterResultDialog(status);
}

async function bootstrapApp() {
  buildApplicationMenu();
  if (process.platform === 'darwin') {
    app.dock?.hide();
    const micGranted = await systemPreferences.askForMediaAccess('microphone');
    if (!micGranted) {
      await logInfo('main', 'Microphone access not granted — voice assistant will be unavailable');
    }
  }
  windowRef = await createWindow();
  tray = new Tray(createTrayImage());
  tray.setToolTip(appName);
  tray.setContextMenu(buildContextMenu());
  tray.on('click', () => {
    void toggleWindow();
  });

  globalShortcut.register(shortcut, () => {
    void toggleWindow();
  });
  await logInfo('main', 'Application bootstrap complete', { shortcut, logPath: getLoggerPath() });
  await showWindow();

  setTimeout(() => {
    void checkForUpdatesInBackground();
  }, 5_000);
}

app.setName(appName);
process.title = appName;

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void showWindow();
  });

  app.on('activate', () => {
    void checkForUpdatesInBackground();
    void showWindow();
  });
}

function registerIpc() {
  const ch = INVOKE_CHANNELS;
  ipcMain.handle(
    ch.deviceBootstrap,
    captureIpc(ch.deviceBootstrap, async () => adapter.getBootstrapState())
  );
  ipcMain.handle(
    ch.deviceScan,
    captureIpc(ch.deviceScan, async () => adapter.scanForDevices())
  );
  ipcMain.handle(
    ch.deviceSave,
    captureIpc(ch.deviceSave, async (_event: unknown, draft: DeviceDraft) =>
      adapter.saveDevice(draft)
    )
  );
  ipcMain.handle(
    ch.deviceRemove,
    captureIpc(ch.deviceRemove, async (_event: unknown, deviceId: string) =>
      adapter.removeDevice(deviceId)
    )
  );
  ipcMain.handle(
    ch.deviceReset,
    captureIpc(ch.deviceReset, async () => adapter.resetState())
  );
  ipcMain.handle(
    ch.deviceStartPairing,
    captureIpc(ch.deviceStartPairing, async (_event: unknown, deviceId: string) =>
      adapter.startPairing(deviceId)
    )
  );
  ipcMain.handle(
    ch.devicePair,
    captureIpc(ch.devicePair, async (_event: unknown, request: PairingRequest) =>
      adapter.pair(request)
    )
  );
  ipcMain.handle(
    ch.deviceConnect,
    captureIpc(ch.deviceConnect, async (_event: unknown, deviceId: string) =>
      adapter.connect(deviceId)
    )
  );
  ipcMain.handle(
    ch.deviceDisconnect,
    captureIpc(ch.deviceDisconnect, async () => adapter.disconnect())
  );
  ipcMain.handle(
    ch.deviceCommand,
    captureIpc(ch.deviceCommand, async (_event: unknown, request: CommandDispatchRequest) => {
      commandMetricsStore.recordIpcReceived(request);
      return adapter.sendCommand(request);
    })
  );
  ipcMain.handle(
    ch.metricsRendererDrop,
    captureIpc(ch.metricsRendererDrop, (_event: unknown, report: CommandDropReport) => {
      commandMetricsStore.recordRendererDrop(report);
      return Promise.resolve();
    })
  );
  ipcMain.handle(
    ch.metricsSnapshot,
    captureIpc(ch.metricsSnapshot, () => Promise.resolve(commandMetricsStore.getSnapshot()))
  );
  ipcMain.handle(
    ch.deviceText,
    captureIpc(ch.deviceText, async (_event: unknown, text: string) => adapter.sendText(text))
  );
  ipcMain.handle(
    ch.deviceAssistantVoiceStart,
    captureIpc(ch.deviceAssistantVoiceStart, async () => adapter.startAssistantVoice())
  );
  ipcMain.handle(
    ch.deviceAssistantVoiceChunk,
    captureIpc(
      ch.deviceAssistantVoiceChunk,
      async (_event: unknown, sessionId: number, chunkBase64: string) =>
        adapter.sendAssistantVoiceChunk(sessionId, chunkBase64)
    )
  );
  ipcMain.handle(
    ch.deviceAssistantVoiceStop,
    captureIpc(ch.deviceAssistantVoiceStop, async (_event: unknown, sessionId: number) =>
      adapter.stopAssistantVoice(sessionId)
    )
  );
  ipcMain.handle(
    ch.deviceAssistantVoicePending,
    captureIpc(ch.deviceAssistantVoicePending, async () =>
      adapter.hasPendingAssistantVoiceSession()
    )
  );
  ipcMain.handle(
    ch.deviceCapabilities,
    captureIpc(ch.deviceCapabilities, async () => adapter.getCapabilities())
  );
  ipcMain.handle(
    ch.updaterCheck,
    captureIpc(ch.updaterCheck, async () => checkForUpdatesManually())
  );
  ipcMain.handle(
    ch.updaterCheckBackground,
    captureIpc(ch.updaterCheckBackground, async () => checkForUpdatesInBackground())
  );
  ipcMain.handle(
    ch.updaterStatus,
    captureIpc(ch.updaterStatus, async () => getUpdaterStatus())
  );
  ipcMain.handle(
    ch.updaterInstall,
    captureIpc(ch.updaterInstall, async () => installAvailableUpdate())
  );
  ipcMain.handle(
    ch.updaterRollback,
    captureIpc(ch.updaterRollback, async () => rollbackToPreviousVersion())
  );
}

if (hasSingleInstanceLock) {
  void app.whenReady().then(async () => {
    try {
      initCapture(process.cwd());
      registerIpc();
      await bootstrapApp();
    } catch (error) {
      await logError('main', 'Application bootstrap failed', error);
      throw error;
    }
  });
}

process.on('uncaughtException', (error) => {
  void logError('main', 'Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  void logError('main', 'Unhandled rejection', reason);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  closeCapture();
});

app.on('window-all-closed', () => {
  // Keep the app alive in the menu bar.
});
