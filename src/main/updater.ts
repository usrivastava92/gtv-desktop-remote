import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { app, BrowserWindow, dialog, shell } from 'electron';

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

function getDialogParentWindow(): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }

  const visible = BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed() && window.isVisible()
  );
  if (visible) {
    return visible;
  }

  const anyWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  return anyWindow;
}

async function showUpdaterDialog(
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  const parent = getDialogParentWindow();
  if (parent) {
    // Bring window forward so the user actually sees the modal even when the dock is hidden.
    if (!parent.isVisible()) {
      parent.show();
    }
    parent.focus();
    return await dialog.showMessageBox(parent, options);
  }

  return await dialog.showMessageBox(options);
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
  await removePathRecursive(getRollbackDirPath()).catch(() => {
    // best-effort
  });
  await writeUpdateState(withoutRollbackState(stateToPersist));
  setUpdaterStatus({
    rollbackAvailable: false,
    rollbackVersion: undefined,
    rollbackCreatedAt: undefined,
  });
}

/**
 * Look for a stray rollback bundle on disk that isn't referenced by update-state.json
 * and recover its metadata. This heals state when a previous install partially
 * cleared metadata (older buggy code paths) while leaving a perfectly good backup
 * on disk, so the user doesn't lose access to the rollback action.
 */
async function recoverOrphanedRollbackState(state: UpdateState): Promise<UpdateState> {
  const rollbackDir = getRollbackDirPath();
  let entries: string[];
  try {
    entries = await fs.readdir(rollbackDir);
  } catch {
    return state;
  }

  const bundle = entries.find((name) => name.toLowerCase().endsWith('.app'));
  if (!bundle) {
    return state;
  }

  const bundlePath = path.join(rollbackDir, bundle);
  try {
    const stats = await fs.stat(bundlePath);
    if (!stats.isDirectory()) {
      return state;
    }

    // Best-effort: read the bundle's Info.plist to recover the version that was
    // backed up. Falls back to the bundle's mtime if reading fails.
    let recoveredVersion: string | undefined;
    try {
      const infoPlist = await fs.readFile(
        path.join(bundlePath, 'Contents', 'Info.plist'),
        'utf-8'
      );
      const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(
        infoPlist
      );
      if (match) {
        recoveredVersion = normalizeVersion(match[1]);
      }
    } catch {
      // ignore, fall through to mtime/unknown
    }

    const recoveredState: UpdateState = {
      ...state,
      rollbackBundleName: bundle,
      rollbackVersion: recoveredVersion ?? state.rollbackVersion ?? 'unknown',
      rollbackCreatedAt: state.rollbackCreatedAt ?? stats.mtime.toISOString(),
    };

    await writeUpdateState(recoveredState).catch(() => {
      // ignore — we'll still surface the rollback in-memory
    });
    await logInfo('updater', 'Recovered orphaned rollback backup', {
      bundlePath,
      version: recoveredState.rollbackVersion,
    });
    return recoveredState;
  } catch {
    return state;
  }
}

async function syncRollbackStatus() {
  let state = await readUpdateState();

  // If metadata is missing but a backup exists on disk, recover it. This
  // self-heals state that older buggy code paths may have wiped after a
  // failed re-backup attempt during install.
  if (!state.rollbackVersion || !state.rollbackBundleName) {
    state = await recoverOrphanedRollbackState(state);
  }

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

function formatMinutesUntil(epochSeconds: number): string {
  const deltaSeconds = epochSeconds - Math.floor(Date.now() / 1000);
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return 'shortly';
  }

  const minutes = Math.ceil(deltaSeconds / 60);
  if (minutes <= 1) {
    return 'in about a minute';
  }
  if (minutes < 60) {
    return `in about ${String(minutes)} minutes`;
  }

  const hours = Math.ceil(minutes / 60);
  return `in about ${String(hours)} hour${hours > 1 ? 's' : ''}`;
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
      // Surface a human-friendly message for GitHub rate limiting so the renderer
      // can display *why* the check failed instead of "see logs".
      const remaining = response.headers.get('x-ratelimit-remaining');
      const resetHeader = response.headers.get('x-ratelimit-reset');
      const retryAfter = response.headers.get('retry-after');

      if (response.status === 403 && remaining === '0') {
        const resetSeconds = Number.parseInt(resetHeader ?? '', 10);
        const when = Number.isFinite(resetSeconds)
          ? formatMinutesUntil(resetSeconds)
          : retryAfter
            ? `in about ${retryAfter} seconds`
            : 'shortly';
        throw new Error(
          `GitHub API rate limit reached for this network. Please try again ${when}.`
        );
      }

      throw new Error(`GitHub API failed: ${String(response.status)} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('Update check timed out. Check your internet connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isDmgAsset(asset: ReleaseAsset) {
  return asset.name.endsWith('.dmg');
}

function findBestMacAsset(assets: ReleaseAsset[]) {
  const arch = process.arch;
  const preferredZip = assets.find((asset) => asset.name.endsWith(`-mac-${arch}.zip`));
  if (preferredZip) return preferredZip;

  const anyZip = assets.find((asset) => asset.name.includes('-mac-') && asset.name.endsWith('.zip'));
  if (anyZip) return anyZip;

  const preferredDmg = assets.find((asset) => asset.name.endsWith(`-mac-${arch}.dmg`));
  if (preferredDmg) return preferredDmg;

  return assets.find((asset) => asset.name.includes('-mac-') && isDmgAsset(asset));
}

function getBundlePathFromExecPath() {
  return path.resolve(process.execPath, '..', '..', '..');
}

/**
 * Best-effort recursive delete that works reliably for macOS .app bundles
 * (Node's fs.rm({ recursive: true }) intermittently throws ENOTEMPTY on Resources
 * directories that contain symlinks, framework hard links, etc.). We try the
 * native API first and fall back to shelling out to `rm -rf`.
 */
async function removePathRecursive(target: string): Promise<void> {
  try {
    await fs.rm(target, { force: true, recursive: true });
    return;
  } catch (primaryError) {
    try {
      await execFile('rm', ['-rf', target]);
    } catch {
      // Re-throw the original Node error so callers see the real reason.
      throw primaryError;
    }
  }
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

  // Stage the new backup in a sibling directory so that, if anything fails, we
  // can leave the previous (working) rollback bundle intact.
  const stagingDir = `${rollbackDir}.new-${String(Date.now())}`;
  const stagingBundlePath = path.join(stagingDir, rollbackBundleName);
  const previousRollbackDir = `${rollbackDir}.prev-${String(Date.now())}`;

  let stagedOk = false;
  try {
    await removePathRecursive(stagingDir);
    await fs.mkdir(stagingDir, { recursive: true });
    await execFile('ditto', [targetBundle, stagingBundlePath]);
    stagedOk = true;
  } catch (error) {
    await logError(
      'updater',
      'Failed to stage rollback backup; preserving previous rollback (if any) and continuing install',
      error
    );
    await removePathRecursive(stagingDir).catch(() => {
      // ignore staging cleanup failure
    });
    // IMPORTANT: do NOT clear rollback metadata or wipe the existing rollback
    // bundle here — a prior install may already have a perfectly good backup
    // that the user still relies on. Refresh status to keep UI in sync.
    await syncRollbackStatus();
    return;
  }

  if (!stagedOk) {
    return;
  }

  // Atomically swap the staged backup in place of the existing one.
  try {
    let movedExisting = false;
    try {
      await fs.rename(rollbackDir, previousRollbackDir);
      movedExisting = true;
    } catch (error) {
      // ENOENT just means there was no previous rollback dir — fine to proceed.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    try {
      await fs.rename(stagingDir, rollbackDir);
    } catch (swapError) {
      // Restore previous rollback if the swap-in failed.
      if (movedExisting) {
        await fs.rename(previousRollbackDir, rollbackDir).catch(() => {
          // best-effort restore
        });
      }
      throw swapError;
    }

    if (movedExisting) {
      await removePathRecursive(previousRollbackDir).catch(() => {
        // ignore deletion of the now-superseded prior backup
      });
    }

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
  } catch (error) {
    // Swap failed but the existing rollback (if any) is untouched. Keep going
    // with the install but DO NOT clear previously valid rollback metadata.
    await logError(
      'updater',
      'Failed to swap in new rollback backup; existing rollback (if any) preserved',
      error
    );
    await removePathRecursive(stagingDir).catch(() => {
      // ignore
    });
    await syncRollbackStatus();
  }
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
        message: (error as Error).message || 'Update check failed. See logs for details.',
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
      message: (error as Error).message || 'Update check failed. See logs for details.',
    });
  }

  return await getUpdaterStatus();
}

export async function installAvailableUpdate() {
  if (!cachedRelease || !cachedAsset || !updaterStatus.latestVersion) {
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      updateAvailable: false,
      updateInstallable: false,
      message: 'No installable update is currently available.',
    });
    return await getUpdaterStatus();
  }

  // Guard against re-entry — the renderer polls and could fire install twice.
  if (updaterStatus.inProgress) {
    return await getUpdaterStatus();
  }

  const version = updaterStatus.latestVersion;

  if (isDmgAsset(cachedAsset)) {
    await shell.openExternal(cachedAsset.browser_download_url);
    await showUpdaterDialog({
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
      await showUpdaterDialog({
        type: 'info',
        buttons: ['OK'],
        defaultId: 0,
        title: 'Dev updater test',
        message: 'Download/install flow completed in dev mode.',
        detail: 'Relaunch is skipped in development override mode.',
      });
      return await getUpdaterStatus();
    }

    const relaunchChoice = await showUpdaterDialog({
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
    // Clear cached release/asset so the renderer's "Update available" panel goes away
    // and the user can re-trigger a fresh check instead of being stuck on a broken install.
    cachedRelease = undefined;
    cachedAsset = undefined;
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      progressPercent: undefined,
      etaSeconds: undefined,
      updateAvailable: false,
      updateInstallable: false,
      message: `Update ${version} failed during download or install. Please try again.`,
    });
    await showUpdaterDialog({
      type: 'warning',
      buttons: ['OK'],
      defaultId: 0,
      title: 'Update failed',
      message: `Update ${version} could not be installed.`,
      detail: (error as Error).message || 'See logs for details.',
    });
  } finally {
    await fs.rm(tmpZipPath, { force: true }).catch(() => {
      // ignore cleanup failure
    });
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

  const choice = await showUpdaterDialog({
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
      await showUpdaterDialog({
        type: 'info',
        buttons: ['OK'],
        defaultId: 0,
        title: 'Dev rollback test',
        message: 'Rollback flow completed in dev mode.',
        detail: 'Restore and relaunch are skipped in development override mode.',
      });
      return await getUpdaterStatus();
    }

    const relaunchChoice = await showUpdaterDialog({
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
