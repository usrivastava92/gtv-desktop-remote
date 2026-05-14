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
}

const RELEASE_OWNER = 'usrivastava92';
const RELEASE_REPO = 'gtv-desktop-remote';
const CHECK_TIMEOUT_MS = 15_000;
const updaterStatus: UpdaterStatus = {
  inProgress: false,
  stage: 'idle',
  currentVersion: app.getVersion(),
  message: 'No update check has run yet.',
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
    .map((part) => {
      return Number.parseInt(part, 10) || 0;
    });
  const bParts = normalizeVersion(b)
    .split('.')
    .map((part) => {
      return Number.parseInt(part, 10) || 0;
    });

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

function findBestMacAsset(assets: ReleaseAsset[]) {
  const arch = process.arch;
  const preferredSuffix = `-mac-${arch}.zip`;

  const preferred = assets.find((asset) => asset.name.endsWith(preferredSuffix));
  if (preferred) return preferred;

  const fallbackZip = assets.find(
    (asset) => asset.name.includes('-mac-') && asset.name.endsWith('.zip')
  );
  return fallbackZip;
}

function getBundlePathFromExecPath() {
  return path.resolve(process.execPath, '..', '..', '..');
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
    if (nextChunk.done) {
      break;
    }

    const value = nextChunk.value;
    chunks.push(value);
    downloadedBytes += value.byteLength;
    onProgress(downloadedBytes, totalBytes);
  }

  await fs.writeFile(destinationPath, Buffer.concat(chunks));
}

async function promptAndInstallMacUpdate(
  release: ReleasePayload,
  asset: ReleaseAsset,
  version: string
) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Update now', 'Skip this version', 'Later'],
    defaultId: 0,
    cancelId: 2,
    title: 'Update available',
    message: `Version ${version} is available. You are on ${app.getVersion()}.`,
    detail: 'The update will be downloaded and installed now.',
  });

  if (response === 1) {
    await writeUpdateState({ skippedVersion: version });
    await logInfo('updater', 'User skipped version', { version });
    return;
  }

  if (response === 2) {
    await logInfo('updater', 'User postponed update', { version });
    return;
  }

  const tmpZipPath = path.join(os.tmpdir(), asset.name);

  try {
    await logInfo('updater', 'Downloading update asset', {
      version,
      asset: asset.name,
      bytes: asset.size,
      url: asset.browser_download_url,
    });

    setUpdaterStatus({
      inProgress: true,
      stage: 'downloading',
      progressPercent: 0,
      etaSeconds: undefined,
      message: `Downloading update ${version}...`,
    });

    const downloadStartTime = Date.now();
    await downloadFile(asset.browser_download_url, tmpZipPath, (downloadedBytes, totalBytes) => {
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
    });

    setUpdaterStatus({
      inProgress: true,
      stage: 'installing',
      progressPercent: 92,
      etaSeconds: 20,
      message: 'Installing update...',
    });
    await installMacUpdateFromZip(tmpZipPath);

    setUpdaterStatus({
      inProgress: true,
      stage: 'installing',
      progressPercent: 100,
      etaSeconds: 0,
      message: 'Installation complete. Awaiting relaunch.',
    });

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

    await dialog
      .showMessageBox({
        type: 'warning',
        buttons: ['Open release page', 'Open Privacy & Security', 'Close'],
        defaultId: 0,
        cancelId: 2,
        title: 'Update failed',
        message: 'The app could not install the update automatically.',
        detail:
          'You can install manually from GitHub. If macOS blocks opening, use Privacy & Security > Open Anyway.',
      })
      .then(async (choice) => {
        if (choice.response === 0) {
          await shell.openExternal(release.html_url);
        }

        if (choice.response === 1) {
          await shell.openExternal(
            'x-apple.systempreferences:com.apple.preference.security?General'
          );
        }
      });
  } finally {
    await fs.rm(tmpZipPath, { force: true });
  }
}

async function checkForMacUpdate() {
  setUpdaterStatus({
    inProgress: true,
    stage: 'checking',
    lastCheckedAt: new Date().toISOString(),
    message: 'Checking for updates...',
  });

  if (!app.isPackaged) {
    await logInfo('updater', 'Skipping updater in development mode');
    setUpdaterStatus({
      inProgress: false,
      stage: 'idle',
      message: 'Update checks are disabled in development mode.',
    });
    return;
  }

  if (process.platform !== 'darwin') {
    await logInfo('updater', 'Skipping updater on unsupported platform', {
      platform: process.platform,
    });
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
    await logInfo('updater', 'No newer release found', { latestVersion, currentVersion });
    setUpdaterStatus({
      inProgress: false,
      stage: 'completed',
      latestVersion,
      progressPercent: 100,
      etaSeconds: 0,
      message: `You're up to date (${currentVersion}).`,
    });
    return;
  }

  const state = await readUpdateState();
  if (state.skippedVersion && normalizeVersion(state.skippedVersion) === latestVersion) {
    await logInfo('updater', 'Latest version was skipped previously', { latestVersion });
    setUpdaterStatus({
      inProgress: false,
      stage: 'completed',
      latestVersion,
      progressPercent: 100,
      etaSeconds: 0,
      message: `Update ${latestVersion} was skipped.`,
    });
    return;
  }

  const selectedAsset = findBestMacAsset(release.assets);
  if (!selectedAsset) {
    await logError('updater', 'No suitable macOS zip asset in latest release', {
      latestVersion,
      assets: release.assets.map((asset) => asset.name),
    });
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      latestVersion,
      progressPercent: undefined,
      etaSeconds: undefined,
      message: `Release ${latestVersion} has no compatible macOS asset.`,
    });
    return;
  }

  setUpdaterStatus({
    latestVersion,
    message: `Update ${latestVersion} is available.`,
  });
  await promptAndInstallMacUpdate(release, selectedAsset, latestVersion);
  setUpdaterStatus({
    inProgress: false,
    stage: 'completed',
    progressPercent: 100,
    etaSeconds: 0,
    message: `Checked updates. Latest: ${latestVersion}.`,
  });
}

export async function checkForUpdatesInBackground() {
  try {
    await checkForMacUpdate();
  } catch (error) {
    await logError('updater', 'Update check failed', error);
    setUpdaterStatus({
      inProgress: false,
      stage: 'failed',
      progressPercent: undefined,
      etaSeconds: undefined,
      message: 'Update check failed. See logs for details.',
    });
  }
}

export async function checkForUpdatesManually() {
  await checkForUpdatesInBackground();
  return getUpdaterStatus();
}

export function getUpdaterStatus(): UpdaterStatus {
  return { ...updaterStatus, currentVersion: app.getVersion() };
}
