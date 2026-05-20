import path from 'node:path';

import { app } from 'electron';

import { createNodeFileSystem } from '../../backend/core/fileSystem';
import { DeviceRepository } from '../../backend/devices/deviceRepository';
import type { SavedDevice } from '../../shared/types';

const repository = new DeviceRepository(createNodeFileSystem(), {
  getCertStateDir: () => app.getPath('userData'),
  getAppDataPath: (...segments) => path.join(app.getPath('userData'), ...segments),
});

export function getDeviceStorePath(): string {
  return repository.storePath();
}

export async function readDevices(): Promise<SavedDevice[]> {
  return repository.read();
}

export async function writeDevices(devices: SavedDevice[]): Promise<void> {
  await repository.write(devices);
}

export async function clearDeviceStore(): Promise<void> {
  await repository.clear();
}
