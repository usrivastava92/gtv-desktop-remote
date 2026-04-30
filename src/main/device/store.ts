import { promises as fs } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import type { SavedDevice } from '../../shared/types';

interface PersistedData {
  devices?: SavedDevice[];
}

const DEFAULT_DATA: PersistedData = {
  devices: [],
};

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'devices.json');
}

export function getDeviceStorePath(): string {
  return getStorePath();
}

export async function readDevices(): Promise<SavedDevice[]> {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as PersistedData;
    return parsed.devices ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

export async function writeDevices(devices: SavedDevice[]): Promise<void> {
  const storePath = getStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify({ ...DEFAULT_DATA, devices }, null, 2), 'utf8');
}

export async function clearDeviceStore(): Promise<void> {
  try {
    await fs.rm(getStorePath(), { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
