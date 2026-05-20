import { beforeEach, describe, expect, it } from 'vitest';

import type { SavedDevice } from '../../../shared/types';
import type { IFileSystem } from '../../core/fileSystem';
import type { IPathProvider } from '../../core/pathProvider';
import { DeviceRepository } from '../deviceRepository';

const STORE_DIR = '/app-data';

const paths: IPathProvider = {
  getCertStateDir: () => STORE_DIR,
  getAppDataPath: (...segments) => [STORE_DIR, ...segments].join('/'),
};

function makeFakeFs(
  seed?: Record<string, string>
): IFileSystem & { dump: () => Record<string, string> } {
  const files = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    readFile: (p, _enc) => {
      const v = files.get(p);
      if (v === undefined) {
        return Promise.reject(Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' }));
      }
      return Promise.resolve(v);
    },
    writeFile: (p, contents, _enc) => {
      files.set(p, contents);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
    rm: (p, _opts) => {
      files.delete(p);
      return Promise.resolve();
    },
    rmRecursive: () => Promise.resolve(),
    rename: () => Promise.resolve(),
    exists: (p) => Promise.resolve(files.has(p)),
    dump: () => Object.fromEntries(files),
  };
}

const PAIRED_DEVICE: SavedDevice = {
  id: 'd1',
  isPaired: true,
  name: 'Living Room TV',
  host: '192.168.1.5',
  adbPort: 5555,
  pairingPort: 6467,
};

describe('DeviceRepository', () => {
  let fs: ReturnType<typeof makeFakeFs>;
  let repo: DeviceRepository;

  beforeEach(() => {
    fs = makeFakeFs();
    repo = new DeviceRepository(fs, paths);
  });

  describe('storePath', () => {
    it('returns devices.json under the app data dir by default', () => {
      expect(repo.storePath()).toBe('/app-data/devices.json');
    });

    it('respects a custom file name', () => {
      const custom = new DeviceRepository(fs, paths, 'my-devices.json');
      expect(custom.storePath()).toBe('/app-data/my-devices.json');
    });
  });

  describe('read', () => {
    it('returns an empty list when the file does not exist (ENOENT)', async () => {
      await expect(repo.read()).resolves.toEqual([]);
    });

    it('returns the devices array from a valid file', async () => {
      fs = makeFakeFs({
        '/app-data/devices.json': JSON.stringify({ devices: [PAIRED_DEVICE] }),
      });
      repo = new DeviceRepository(fs, paths);
      const devices = await repo.read();
      expect(devices).toEqual([PAIRED_DEVICE]);
    });

    it('returns an empty list when JSON has no `devices` key (legacy format)', async () => {
      fs = makeFakeFs({ '/app-data/devices.json': JSON.stringify({}) });
      repo = new DeviceRepository(fs, paths);
      await expect(repo.read()).resolves.toEqual([]);
    });

    it('returns an empty list when `devices` is null', async () => {
      fs = makeFakeFs({
        '/app-data/devices.json': JSON.stringify({ devices: null }),
      });
      repo = new DeviceRepository(fs, paths);
      await expect(repo.read()).resolves.toEqual([]);
    });
  });

  describe('write', () => {
    it('persists devices under the canonical key', async () => {
      await repo.write([PAIRED_DEVICE]);
      const raw = fs.dump()['/app-data/devices.json'];
      expect(raw).toBeDefined();
      expect(JSON.parse(raw ?? '{}')).toEqual({ devices: [PAIRED_DEVICE] });
    });

    it('round-trips through read', async () => {
      await repo.write([PAIRED_DEVICE]);
      await expect(repo.read()).resolves.toEqual([PAIRED_DEVICE]);
    });

    it('formats with 2-space indentation (matches the pre-extraction format)', async () => {
      await repo.write([PAIRED_DEVICE]);
      const raw = fs.dump()['/app-data/devices.json'] ?? '';
      expect(raw).toContain('\n  "devices"');
    });
  });

  describe('clear', () => {
    it('removes the file', async () => {
      await repo.write([PAIRED_DEVICE]);
      await repo.clear();
      expect(fs.dump()['/app-data/devices.json']).toBeUndefined();
    });

    it('is a no-op when the file is absent', async () => {
      await expect(repo.clear()).resolves.toBeUndefined();
    });
  });
});
