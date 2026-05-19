import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { app, dialog, shell } from 'electron';

import type { UpdaterStatus } from '../shared/types';

import { getAppDataPath, logError, logInfo } from './logger';

const execFile = promisify(execFileCallback);

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface ReleasePayload {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

interface UpdateState {
  skippedVersion?: string;
  rollbackVersion?: string;
  rollbackCreatedAt?: string;
  rollbackBundleName?: string;
}

const RELEASE_OWNER = 'usrivastava92';
const RELEASE_REPO = 'gtv-desktop-remote';
const CHECK_TIMEOUT_MS = 15_000;
const BACKGROUND_CHECK_DEBOUNCE_MS = 15 * 60 * 1_000;
const DEV_UPDATER_ENABLED = process.env.GTV_UPDATER_DEV === '1';
const ROLLBACK_DIR_NAME = 'rollback';

let cachedRelease: ReleasePayload | undefined;
let cachedAsset: ReleaseAsset | undefined;
let activeBackgroundCheck: Promise<void> | undefined;

const updaterStatus: UpdaterStatus = {
  inProgress: false,
  stage: 'idle',
  currentVersion: app.getVersion(),
  message: 'No update check has run yet.',
  updateAvailable: false,
  updateInstallable: false,
  rollbackAvailable: false,
};

function setUpdaterStatus(next: Partial<UpdaterStatus>) {
  Object.assign(updaterStatus, next, { currentVersion: app.getVersion() });
}

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, '');
}

function compareVersions(a: string, b: string) {
  const aParts = normalizeVersion(a)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const bParts = normalizeVersion(b)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

  const max = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < max; i += 1) {
    const left = aParts[i] ?? 0;
    const right = bParts[i] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }

  return 0;
}

async function readUpdateState(): Promise<UpdateState> {
  const statePath = getAppDataPath('updater-state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    return JSON.parse(raw) as UpdateState;
  } catch {
    return {};
  }
}

async function writeUpdateState(state: UpdateState) {
  const statePath = getAppDataPath('updater-state.json');
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function getRollbackDirPath() {
  return getAppDataPath(ROLLBACK_DIR_NAME);
}

function getRollbackBundlePath(state: UpdateState) {
  if (!state.rollbackBundleName) {
    return undefined;
  }

  return path.join(getRollbackDirPath(), state.rollbackBundleName);
}

async function rollbackBundleExists(state: UpdateState) {
  const rollbackBundlePath = getRollbackBundlePath(state);
  if (!rollbackBundlePath) {
    return false;
  }

  try {
    const stats = await fs.stat(rollbackBundlePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function withoutRollbackState(state: UpdateState): UpdateState {
  const nextState = { ...state };
  delete nextState.rollbackVersion;
  delete nextState.rollbackCreatedAt;
  delete nextState.rollbackBundleName;
  return nextState;
}

async function clearRollbackBackup(state?: UpdateState) {
  const stateToPersist = state ?? (await readUpdateState());
  await fs.rm(getRollbackDirPath(), { force: true, recursive: true });
  await writeUpdateState(withoutRollbackState(stateToPersist));
  setUpdaterStatus({
    rollbackAvailable: false,
    rollbackVersion: undefined,
    rollbackCreatedAt: undefined,
  });
}

async function syncRollbackStatus() {
  const state = await readUpdateState();
  const available =
    Boolean(state.rollbackVersion && state.rollbackCreatedAt) &&
    (await rollbackBundleExists(state));

  if (!available) {
    setUpdaterStatus({
      rollbackAvailable: false,
      rollbackVersion: undefined,
      rollbackCreatedAt: undefined,
    });
    return state;
  }

  setUpdaterStatus({
    rollbackAvailable: true,
    rollbackVersion: state.rollbackVersion,
    rollbackCreatedAt: state.rollbackCreatedAt,
  });
  return state;
}

async function requestJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'gtv-desktop-remote-updater',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub API failed: ${String(response.status)} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function isZipAsset(asset: ReleaseAsset) {
  return asset.name.endsWith('.zip');
}

function isDmgAsset(asset: ReleaseAsset) {
  return asset.name.endsWith('.dmg');
}

function findBestMacAsset(assets: ReleaseAsset[]) {
  const arch = process.arch;
  const preferredZip = assets.find((asset) => asset.name.endsWith(`-mac-${arch}.zip`));
  if (preferredZip) return preferredZip;

  const anyZip = assets.find((asset) => asset.name.includes('-mac-') && isZipAsset(asset));
  if (anyZip) return anyZip;

  const preferredDmg = assets.find((asset) => asset.name.endsWith(`-mac-${arch}.dmg`));
  if (preferredDmg) return preferredDmg;

  return assets.find((asset) => asset.name.includes('-mac-') && isDmgAsset(asset));
}

function getBundlePathFromExecPath() {
  return path.resolve(process.execPath, '..', '..', '..');
}

async function createRollbackBackup(targetBundle: string) {
  const state = await readUpdateState();
  const rollbackDir = getRollbackDirPath();
  const rollbackBundleName = path.basename(targetBundle);
  const rollbackBundlePath = path.join(rollbackDir, rollbackBundleName);
  const rollbackVersion = normalizeVersion(app.getVersion());
  const rollbackCreatedAt = new Date().toISOString();

  await logInfo('updater', 'Creating rollback backup', {
    sourceBundle: targetBundle,
    rollbackBundlePath,
    rollbackVersion,
  });

  await fs.rm(rollbackDir, { force: true, recursive: true });
  await fs.mkdir(rollbackDir, { recursive: true });
  await execFile('ditto', [targetBundle, rollbackBundlePath]);

  await writeUpdateState({
    ...state,
    rollbackVersion,
    rollbackCreatedAt,
    rollbackBundleName,
  });
  setUpdaterStatus({
    rollbackAvailable: true,
    rollbackVersion,
    rollbackCreatedAt,
  });
}

async function installMacUpdateFromZip(zipPath: string) {
  const unpackDir = path.join(os.tmpdir(), `gtv-update-unpack-${String(Date.now())}`);
  await fs.mkdir(unpackDir, { recursive: true });

  await execFile('ditto', ['-x', '-k', zipPath, unpackDir]);

  const entries = await fs.readdir(unpackDir, { withFileTypes: true });
  const appDir = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  if (!appDir) {
    throw new Error('Downloaded archive did not contain an .app bundle');
  }

  const sourceBundle = path.join(unpackDir, appDir.name);
  const targetBundle = getBundlePathFromExecPath();

  await logInfo('updater', 'Installing update bundle', { sourceBundle, targetBundle });

  if (DEV_UPDATER_ENABLED && !app.isPackaged) {
    await logInfo('updater', 'Dev mode update install skipped', { sourceBundle, targetBundle });
    return;
  }

  await createRollbackBackup(targetBundle);
  await execFile('ditto', [sourceBundle, targetBundle]);
  await execFile('xattr', ['-dr', 'com.apple.quarantine', targetBundle]);
}

async function downloadFile(
  url: string,
  destinationPath: string,
  onProgress: (downloadedBytes: number, totalBytes: number) => void
) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'gtv-desktop-remote-updater',
      Accept: 'application/octet-stream',
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download update: ${String(response.status)} ${response.statusText}`);
  }

  const totalBytes = Number.parseInt(response.headers.get('content-length') ?? '0', 10) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;

  for (;;) {
    const nextChunk = await reader.read();
    if (nextChunk.done) break;

    const value = nextChunk.value;
    chunks.push(value);
    downloadedBytes += value.byteLength;
    onProgress(downloadedBytes, totalBytes);
  }

  await fs.writeFile(destinationPath, Buffer.concat(chunks));
}

async function checkForMacUpdate() {
  setUpdaterStatus({
    inProgress: true,
    stage: 'checking',
    lastCheckedAt: new Date().toISOString(),
    message: 'Checking for updates...',
    updateAvailable: false,
    updateInstallable: false,
  });

  const updatesAllowed = app.isPackaged || DEV_UPDATER_ENABLED;

  if (!updatesAllowed) {
    await logInfo('updater', 'Skipping updater in development mode');
    setUpdaterStatus({
      inProgress: false,
      stage: 'idle',
      message: 'Update checks are disabled in development mode. Set GTV_UPDATER_DEV=1 to test.',
    });
    return;
  }

  if (process.platform !== 'darwin') {
    setUpdaterStatus({
      inProgress: false,
      stage: 'idle',
      message: `Updates are not configured for ${process.platform}.`,
    });
    return;
  }

  const release = await requestJson<ReleasePayload>(
    `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`
  );

  const latestVersion = normalizeVersion(release.tag_name);
  const currentVersion = normalizeVersion(app.getVersion());

  if (compareVersions(latestVersion, currentVersion) <= 0) {
    cachedRelease = undefined;
    cachedAsset = undefined;
    setUpdaterStatus({
      inProgress: false,
      stage: 'completed',
      latestVersion,
      progressPercent: 100,
      etaSeconds: 0,
      updateAvailable: false,
      updateInstallable: false,
      message: `You're up to date (${currentVersion}).`,
    });
    return;
  }

  const state = await readUpdateState();
  if (state.skippedVersion && normalizeVersion(state.skippedVersion) === latestVersion) {
    cachedRelease = undefined;
    cachedAsset = undefined;
    setUpdaterStatus({
      inProgress: false,
      stage: 'completed',
      latestVersion,
      progressPercent: 100,
      etaSeconds: 0,
      updateAvailable: false,
      updateInstallable: false,
      message: `Update ${latestVersion} was skipped.`,
    });
    return;
  }

  const selectedAsset = findBestMacAsset(release.assets);
  if (!selectedAsset) {
    cachedRelease = undefined;
    cachedAsset = undefined;
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      latestVersion,
      updateAvailable: true,
      updateInstallable: false,
      message: `Release ${latestVersion} has no compatible macOS asset.`,
    });
    return;
  }

  cachedRelease = release;
  cachedAsset = selectedAsset;
  setUpdaterStatus({
    inProgress: false,
    stage: 'completed',
    latestVersion,
    updateAvailable: true,
    updateInstallable: true,
    message: `Update ${latestVersion} is available.`,
  });
}

export async function checkForUpdatesInBackground() {
  if (activeBackgroundCheck) {
    await activeBackgroundCheck;
    return await getUpdaterStatus();
  }

  const lastCheckedAt = updaterStatus.lastCheckedAt
    ? Date.parse(updaterStatus.lastCheckedAt)
    : Number.NaN;
  const shouldDebounce =
    Number.isFinite(lastCheckedAt) && Date.now() - lastCheckedAt < BACKGROUND_CHECK_DEBOUNCE_MS;

  if (shouldDebounce) {
    return await getUpdaterStatus();
  }

  activeBackgroundCheck = (async () => {
    try {
      await checkForMacUpdate();
    } catch (error) {
      await logError('updater', 'Update check failed', error);
      setUpdaterStatus({
        inProgress: false,
        stage: 'failed',
        progressPercent: undefined,
        etaSeconds: undefined,
        updateAvailable: false,
        updateInstallable: false,
        message: 'Update check failed. See logs for details.',
      });
    }
  })();

  try {
    await activeBackgroundCheck;
  } finally {
    activeBackgroundCheck = undefined;
  }

  return await getUpdaterStatus();
}

export async function checkForUpdatesManually() {
  if (activeBackgroundCheck) {
    await activeBackgroundCheck;
  }

  try {
    await checkForMacUpdate();
  } catch (error) {
    await logError('updater', 'Update check failed', error);
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      progressPercent: undefined,
      etaSeconds: undefined,
      updateAvailable: false,
      updateInstallable: false,
      message: 'Update check failed. See logs for details.',
    });
  }

  return await getUpdaterStatus();
}

export async function installAvailableUpdate() {
  if (!cachedRelease || !cachedAsset || !updaterStatus.latestVersion) {
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      message: 'No installable update is currently available.',
    });
    return await getUpdaterStatus();
  }

  const version = updaterStatus.latestVersion;

  const choice = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Update now', 'Skip this version', 'Later'],
    defaultId: 0,
    cancelId: 2,
    title: 'Update available',
    message: `Version ${version} is available. You are on ${app.getVersion()}.`,
    detail: isZipAsset(cachedAsset)
      ? 'The update will be downloaded and installed now.'
      : 'This update is available as DMG and will open in your browser for manual install.',
  });

  if (choice.response === 1) {
    const state = await readUpdateState();
    await writeUpdateState({ ...state, skippedVersion: version });
    cachedRelease = undefined;
    cachedAsset = undefined;
    setUpdaterStatus({
      updateAvailable: false,
      updateInstallable: false,
      message: `Update ${version} was skipped.`,
    });
    return await getUpdaterStatus();
  }

  if (choice.response === 2) {
    return await getUpdaterStatus();
  }

  if (isDmgAsset(cachedAsset)) {
    await shell.openExternal(cachedAsset.browser_download_url);
    await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK'],
      defaultId: 0,
      title: 'Manual install',
      message: 'DMG opened in your browser.',
      detail:
        'Open the DMG, drag the app to Applications, then if macOS blocks launch use Privacy & Security > Open Anyway.',
    });
    return await getUpdaterStatus();
  }

  const tmpZipPath = path.join(os.tmpdir(), cachedAsset.name);

  try {
    setUpdaterStatus({
      inProgress: true,
      stage: 'downloading',
      progressPercent: 0,
      etaSeconds: undefined,
      message: `Downloading update ${version}...`,
    });

    const downloadStartTime = Date.now();
    await downloadFile(
      cachedAsset.browser_download_url,
      tmpZipPath,
      (downloadedBytes, totalBytes) => {
        const elapsedSeconds = Math.max(1, (Date.now() - downloadStartTime) / 1000);
        const bytesPerSecond = downloadedBytes / elapsedSeconds;
        const remainingBytes = Math.max(0, totalBytes - downloadedBytes);
        const etaSeconds =
          bytesPerSecond > 0 && totalBytes > 0
            ? Math.ceil(remainingBytes / bytesPerSecond)
            : undefined;
        const progressPercent =
          totalBytes > 0
            ? Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
            : undefined;

        setUpdaterStatus({
          inProgress: true,
          stage: 'downloading',
          progressPercent,
          etaSeconds,
          message:
            progressPercent !== undefined
              ? `Downloading update ${version}... ${String(progressPercent)}%`
              : `Downloading update ${version}...`,
        });
      }
    );

    setUpdaterStatus({
      inProgress: true,
      stage: 'installing',
      progressPercent: 95,
      etaSeconds: 10,
      message: 'Installing update...',
    });

    await installMacUpdateFromZip(tmpZipPath);

    setUpdaterStatus({
      inProgress: false,
      stage: 'completed',
      progressPercent: 100,
      etaSeconds: 0,
      updateAvailable: false,
      updateInstallable: false,
      message:
        DEV_UPDATER_ENABLED && !app.isPackaged
          ? 'Dev mode: install step skipped.'
          : `Update ${version} installed.`,
    });

    if (DEV_UPDATER_ENABLED && !app.isPackaged) {
      await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK'],
        defaultId: 0,
        title: 'Dev updater test',
        message: 'Download/install flow completed in dev mode.',
        detail: 'Relaunch is skipped in development override mode.',
      });
      return await getUpdaterStatus();
    }

    const relaunchChoice = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Relaunch now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update installed',
      message: `Version ${version} was installed.`,
      detail: 'Relaunch to start the updated app.',
    });

    if (relaunchChoice.response === 0) {
      app.relaunch();
      app.quit();
    }
  } catch (error) {
    await logError('updater', 'Automatic update installation failed', error);
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      progressPercent: undefined,
      etaSeconds: undefined,
      message: 'Update failed during download or install.',
    });
  } finally {
    await fs.rm(tmpZipPath, { force: true });
  }

  return await getUpdaterStatus();
}

export async function rollbackToPreviousVersion() {
  if (updaterStatus.inProgress) {
    setUpdaterStatus({
      message: 'Cannot roll back while another update operation is in progress.',
    });
    return await getUpdaterStatus();
  }

  const state = await syncRollbackStatus();
  const rollbackBundlePath = getRollbackBundlePath(state);

  if (!state.rollbackVersion || !rollbackBundlePath || !(await rollbackBundleExists(state))) {
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      rollbackAvailable: false,
      rollbackVersion: undefined,
      rollbackCreatedAt: undefined,
      message: 'No previous version backup is available.',
    });
    return await getUpdaterStatus();
  }

  const choice = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Rollback now', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Rollback available',
    message: `Roll back to version ${state.rollbackVersion}?`,
    detail:
      'The current app bundle will be replaced with the previous version saved before the last in-app update.',
  });

  if (choice.response === 1) {
    return await getUpdaterStatus();
  }

  const targetBundle = getBundlePathFromExecPath();

  try {
    setUpdaterStatus({
      inProgress: true,
      stage: 'installing',
      progressPercent: 20,
      etaSeconds: undefined,
      message: `Rolling back to ${state.rollbackVersion}...`,
    });

    await logInfo('updater', 'Restoring rollback backup', {
      rollbackBundlePath,
      targetBundle,
      rollbackVersion: state.rollbackVersion,
    });

    if (DEV_UPDATER_ENABLED && !app.isPackaged) {
      await logInfo('updater', 'Dev mode rollback restore skipped', {
        rollbackBundlePath,
        targetBundle,
      });
    } else {
      await execFile('ditto', [rollbackBundlePath, targetBundle]);
      await execFile('xattr', ['-dr', 'com.apple.quarantine', targetBundle]);
    }

    await clearRollbackBackup(state);
    setUpdaterStatus({
      inProgress: false,
      stage: 'completed',
      progressPercent: 100,
      etaSeconds: 0,
      rollbackAvailable: false,
      rollbackVersion: undefined,
      rollbackCreatedAt: undefined,
      updateAvailable: false,
      updateInstallable: false,
      message:
        DEV_UPDATER_ENABLED && !app.isPackaged
          ? 'Dev mode: rollback restore skipped.'
          : `Rolled back to ${state.rollbackVersion}.`,
    });

    if (DEV_UPDATER_ENABLED && !app.isPackaged) {
      await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK'],
        defaultId: 0,
        title: 'Dev rollback test',
        message: 'Rollback flow completed in dev mode.',
        detail: 'Restore and relaunch are skipped in development override mode.',
      });
      return await getUpdaterStatus();
    }

    const relaunchChoice = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Relaunch now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Rollback complete',
      message: `Version ${state.rollbackVersion} was restored.`,
      detail: 'Relaunch to start the restored app.',
    });

    if (relaunchChoice.response === 0) {
      app.relaunch();
      app.quit();
    }
  } catch (error) {
    await logError('updater', 'Rollback failed', error);
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      progressPercent: undefined,
      etaSeconds: undefined,
      message: 'Rollback failed while restoring the previous version.',
    });
  }

  return await getUpdaterStatus();
}

export async function getUpdaterStatus(): Promise<UpdaterStatus> {
  await syncRollbackStatus();
  return { ...updaterStatus, currentVersion: app.getVersion() };
}
