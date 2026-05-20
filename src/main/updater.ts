import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { app, BrowserWindow, dialog, shell } from 'electron';

import { getRuntimeConfig } from '../backend/core/runtimeConfig';
import {
  applyUpdaterEvent,
  createInitialUpdaterStatus,
  mergeUpdaterStatus,
  type UpdaterEvent,
} from '../backend/updater/updaterStatus';
import {
  compareVersions,
  findBestMacAsset,
  formatMinutesUntil,
  isDmgAsset,
  normalizeVersion,
} from '../backend/updater/version';
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
// PR-QW-runtime: was `const DEV_UPDATER_ENABLED = process.env.GTV_UPDATER_DEV === '1';`
// Now sourced from the runtime config port so tests can flip the flag without
// monkey-patching process.env (which leaks across vitest workers).
const ROLLBACK_DIR_NAME = 'rollback';

let cachedRelease: ReleasePayload | undefined;
let cachedAsset: ReleaseAsset | undefined;
let activeBackgroundCheck: Promise<void> | undefined;

// PR-6a: initial status now comes from the pure helper in
// src/backend/updater/updaterStatus.ts. The helper is unit-tested in
// isolation so a future drift in the "fresh app" state is caught before it
// reaches users.
const updaterStatus: UpdaterStatus = createInitialUpdaterStatus(app.getVersion());

/**
 * Subscribers receive a fresh snapshot of `UpdaterStatus` every time the
 * status changes. Registered by `subscribeUpdaterStatus` and called
 * synchronously from `setUpdaterStatus`. QW-2 uses this to push the status
 * to the renderer over IPC, replacing the previous 1.5s polling loop.
 */
type UpdaterStatusListener = (status: UpdaterStatus) => void;
const updaterStatusListeners = new Set<UpdaterStatusListener>();

/** Snapshot the current status. Defensive copy so callers cannot mutate. */
function snapshotUpdaterStatus(): UpdaterStatus {
  return { ...updaterStatus };
}

/**
 * Subscribe to updater status changes. Returns an unsubscribe function.
 * Listeners receive a defensive copy of the status on every change.
 */
export function subscribeUpdaterStatus(listener: UpdaterStatusListener): () => void {
  updaterStatusListeners.add(listener);
  return () => {
    updaterStatusListeners.delete(listener);
  };
}

function setUpdaterStatus(next: Partial<UpdaterStatus>) {
  // PR-6a: delegate the merge to the pure `mergeUpdaterStatus` helper, then
  // mutate the module-level singleton in place. (PR-6b adds an
  // `UpdaterEvent`-dispatch alternative — `dispatchUpdaterEvent` — that uses
  // `applyUpdaterEvent` internally and reuses the listener fan-out below via
  // `publishUpdaterStatus`.)
  const merged = mergeUpdaterStatus(updaterStatus, next, app.getVersion());
  Object.assign(updaterStatus, merged);
  publishUpdaterStatus();
}

/**
 * PR-6b: dispatch a typed `UpdaterEvent` and let `applyUpdaterEvent` (the
 * pure reducer in src/backend/updater/updaterStatus.ts) compute the new
 * status. Identical listener fan-out as `setUpdaterStatus`.
 *
 * This is the migration target for the 16+ inline `setUpdaterStatus({...})`
 * call sites. Migration is per-site and can land incrementally; both code
 * paths produce byte-identical output via the same reducer.
 */
function dispatchUpdaterEvent(event: UpdaterEvent) {
  const next = applyUpdaterEvent(updaterStatus, event, app.getVersion());
  Object.assign(updaterStatus, next);
  publishUpdaterStatus();
}

/** Shared fan-out used by both `setUpdaterStatus` and `dispatchUpdaterEvent`. */
function publishUpdaterStatus() {
  const snapshot = snapshotUpdaterStatus();
  for (const listener of updaterStatusListeners) {
    try {
      listener(snapshot);
    } catch (error) {
      // Listener errors must never affect the update flow. We log and move on.
      void logError('updater', 'Updater status listener threw', { error });
    }
  }
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

// normalizeVersion + compareVersions extracted to src/backend/updater/version.ts (PR-6).

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
      const infoPlist = await fs.readFile(path.join(bundlePath, 'Contents', 'Info.plist'), 'utf-8');
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

// formatMinutesUntil extracted to src/backend/updater/version.ts (PR-6).

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
      throw new Error('Update check timed out. Check your internet connection and try again.', {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// isDmgAsset + findBestMacAsset extracted to src/backend/updater/version.ts (PR-6).

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

  try {
    await removePathRecursive(stagingDir);
    await fs.mkdir(stagingDir, { recursive: true });
    await execFile('ditto', [targetBundle, stagingBundlePath]);
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

  if (getRuntimeConfig().devUpdaterEnabled && !app.isPackaged) {
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
  // PR-6b: first call site migrated from `setUpdaterStatus(partial)` to
  // `dispatchUpdaterEvent`. The reducer's `check-started` event covers
  // `inProgress: true`, `stage: 'checking'`, and the "Checking…" message.
  // The two extra fields previously set inline (`lastCheckedAt`,
  // `updateAvailable: false`, `updateInstallable: false`) are followed up
  // with a `setUpdaterStatus(partial)` so this PR introduces zero behavior
  // change. Future PR-6c will extend `check-started` to optionally carry
  // these fields and collapse the two calls.
  dispatchUpdaterEvent({ type: 'check-started' });
  setUpdaterStatus({
    lastCheckedAt: new Date().toISOString(),
    updateAvailable: false,
    updateInstallable: false,
  });

  // PR-QW-runtime: read the flag through the runtime config port. In
  // production this transitively reads process.env.GTV_UPDATER_DEV via
  // createNodeRuntimeConfig(); in tests, callers install a fake config via
  // setRuntimeConfig(createRuntimeConfig({ devUpdaterEnabled: ... })).
  const updatesAllowed = app.isPackaged || getRuntimeConfig().devUpdaterEnabled;

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

  // PR-6c: 2 call sites migrated from setUpdaterStatus(partial) to
  // dispatchUpdaterEvent({ type: 'check-completed-no-update', ... }). The
  // reducer's stage/progress/UX fields exactly match the previous inline
  // values (validated by the round-trip reducer tests below), so this is
  // a pure refactor with zero behavior change. `lastCheckedAt` was set in
  // the prologue; we re-read the current value off updaterStatus to honor
  // the existing serialization timing.
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    cachedRelease = undefined;
    cachedAsset = undefined;
    dispatchUpdaterEvent({
      type: 'check-completed-no-update',
      latestVersion,
      lastCheckedAt: updaterStatus.lastCheckedAt ?? new Date().toISOString(),
      message: `You're up to date (${currentVersion}).`,
    });
    return;
  }

  const state = await readUpdateState();
  if (state.skippedVersion && normalizeVersion(state.skippedVersion) === latestVersion) {
    cachedRelease = undefined;
    cachedAsset = undefined;
    dispatchUpdaterEvent({
      type: 'check-completed-no-update',
      latestVersion,
      lastCheckedAt: updaterStatus.lastCheckedAt ?? new Date().toISOString(),
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
  // PR-6d: migrate to dispatchUpdaterEvent. The reducer's
  // check-completed-update-available variant was pre-aligned in PR-6c
  // (stage: 'completed') so this is a zero-UX-change migration.
  // `lastCheckedAt` falls back to the value already on updaterStatus from
  // the preceding check-started dispatch (line ~568) — the reducer's
  // mergeUpdaterStatus preserves it. We supply the new timestamp here for
  // freshness.
  dispatchUpdaterEvent({
    type: 'check-completed-update-available',
    latestVersion,
    lastCheckedAt: new Date().toISOString(),
    installable: true,
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
      // PR-6d: migrate to dispatchUpdaterEvent. The reducer's check-failed
      // variant already sets stage: 'failed' + inProgress: false; the
      // remaining fields (progressPercent/etaSeconds/updateAvailable/
      // updateInstallable) become caller-supplied via the reducer rather
      // than this inline partial. Reducer revision: now also clears those
      // 4 fields to match the prior inline shape (zero UX change).
      dispatchUpdaterEvent({
        type: 'check-failed',
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
  // PR-QW-runtime: hoist the dev-override check into a single local so the
  // status `message` and the subsequent skip-relaunch branch stay in lockstep
  // and the runtime config port is read exactly once per install call.
  const installDevModeOverride = getRuntimeConfig().devUpdaterEnabled && !app.isPackaged;

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
    // PR-6e: migrate to dispatchUpdaterEvent. Reducer was extended in this
    // same PR to honor a caller-supplied message so the prior "Downloading
    // update X..." (ASCII "...") format is preserved.
    dispatchUpdaterEvent({
      type: 'download-started',
      latestVersion: version,
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

        // PR-6e: migrate to dispatchUpdaterEvent. The reducer derives the
        // exact same UX message + stage from `latestVersion + progressPercent`.
        dispatchUpdaterEvent({
          type: 'download-progress',
          latestVersion: version,
          progressPercent,
          etaSeconds,
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
      message: installDevModeOverride
        ? 'Dev mode: install step skipped.'
        : `Update ${version} installed.`,
    });

    if (installDevModeOverride) {
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

    // PR-QW-runtime: hoist the dev-override check into a single local so all
    // three branch points below stay in lockstep and the runtime config port
    // is read exactly once per rollback call.
    const devModeOverride = getRuntimeConfig().devUpdaterEnabled && !app.isPackaged;

    if (devModeOverride) {
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
      message: devModeOverride
        ? 'Dev mode: rollback restore skipped.'
        : `Rolled back to ${state.rollbackVersion}.`,
    });

    if (devModeOverride) {
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
