import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IFileSystem } from '../../../core/fileSystem';
import type { ILogger } from '../../../core/logger';
import type { IPathProvider } from '../../../core/pathProvider';
import { AndroidTvCertStore } from '../androidTvCertStore';

/**
 * In-memory IFileSystem for tests. Files are stored as a Map<absPath, content>.
 * Directories are implicit — `mkdir` is a no-op (Map keys are flat).
 */
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
    rmRecursive: (prefix) => {
      // Best-effort recursive delete: drop every key starting with the prefix.
      for (const key of [...files.keys()]) {
        if (key === prefix || key.startsWith(`${prefix}/`)) {
          files.delete(key);
        }
      }
      return Promise.resolve();
    },
    rename: (from, to) => {
      const v = files.get(from);
      if (v === undefined) {
        return Promise.reject(Object.assign(new Error(`ENOENT: ${from}`), { code: 'ENOENT' }));
      }
      files.delete(from);
      files.set(to, v);
      return Promise.resolve();
    },
    exists: (p) => Promise.resolve(files.has(p)),
    dump: () => Object.fromEntries(files),
  };
}

const STATE_DIR = '/tmp/cert-state';
const paths: IPathProvider = {
  getCertStateDir: () => STATE_DIR,
  getAppDataPath: (...segments) => [STATE_DIR, ...segments].join('/'),
};

const FAKE_PEM: { cert: string; key: string } = {
  cert: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n',
  key: '-----BEGIN RSA PRIVATE KEY-----\nFAKE\n-----END RSA PRIVATE KEY-----\n',
};

describe('AndroidTvCertStore — Google TV non-regression gate', () => {
  let fs: ReturnType<typeof makeFakeFs>;
  let logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  } & ILogger;
  let generator: ReturnType<typeof vi.fn>;
  let store: AndroidTvCertStore;

  beforeEach(() => {
    fs = makeFakeFs();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    generator = vi.fn().mockReturnValue(FAKE_PEM);
    store = new AndroidTvCertStore(fs, paths, logger, generator);
  });

  describe('getFilesForCertKey', () => {
    it('returns canonical paths under getCertStateDir()', () => {
      const { certPath, keyPath } = store.getFilesForCertKey('AA:BB:CC:DD:EE:FF');
      expect(certPath).toBe(`${STATE_DIR}/AA_BB_CC_DD_EE_FF.cert.pem`);
      expect(keyPath).toBe(`${STATE_DIR}/AA_BB_CC_DD_EE_FF.key.pem`);
    });

    it('sanitises both colons and slashes — same key gives same path', () => {
      const a = store.getFilesForCertKey('AA:BB:CC');
      const b = store.getFilesForCertKey('AA_BB_CC');
      expect(a.certPath).toBe(b.certPath);
    });

    it('sanitises slashes in hostnames (e.g. CIDR-like keys)', () => {
      const { certPath } = store.getFilesForCertKey('host/with/slashes');
      expect(certPath).toBe(`${STATE_DIR}/host_with_slashes.cert.pem`);
    });

    it('handles plain hostnames unchanged', () => {
      const { certPath } = store.getFilesForCertKey('192.168.1.5');
      expect(certPath).toBe(`${STATE_DIR}/192.168.1.5.cert.pem`);
    });
  });

  describe('loadOrCreate', () => {
    it('generates and persists a new cert pair when none exists', async () => {
      const result = await store.loadOrCreate('mac1');
      expect(result).toEqual(FAKE_PEM);
      expect(generator).toHaveBeenCalledTimes(1);
      const dump = fs.dump();
      expect(dump[`${STATE_DIR}/mac1.cert.pem`]).toBe(FAKE_PEM.cert);
      expect(dump[`${STATE_DIR}/mac1.key.pem`]).toBe(FAKE_PEM.key);
      expect(logger.info.mock.calls).toContainEqual([
        'androidTvCertStore',
        'Generated new client certificate',
        { certKey: 'mac1' },
      ]);
    });

    it('loads an existing cert pair without regenerating', async () => {
      fs = makeFakeFs({
        [`${STATE_DIR}/mac1.cert.pem`]: 'PERSISTED_CERT',
        [`${STATE_DIR}/mac1.key.pem`]: 'PERSISTED_KEY',
      });
      store = new AndroidTvCertStore(fs, paths, logger, generator);
      const result = await store.loadOrCreate('mac1');
      expect(result).toEqual({ cert: 'PERSISTED_CERT', key: 'PERSISTED_KEY' });
      expect(generator).not.toHaveBeenCalled();
      expect(logger.info.mock.calls).toHaveLength(0);
    });

    it('regenerates if cert exists but key is missing (partial state)', async () => {
      fs = makeFakeFs({ [`${STATE_DIR}/mac1.cert.pem`]: 'STALE' });
      store = new AndroidTvCertStore(fs, paths, logger, generator);
      const result = await store.loadOrCreate('mac1');
      expect(result).toEqual(FAKE_PEM);
      expect(generator).toHaveBeenCalledTimes(1);
    });
  });

  describe('migrate — the IP-change scenario that historically breaks pairing', () => {
    it('is a no-op when oldKey === newKey', async () => {
      await store.migrate('192.168.1.5', '192.168.1.5');
      expect(fs.dump()).toEqual({});
      expect(logger.info.mock.calls).toHaveLength(0);
    });

    it('renames old files into the new key when new is absent', async () => {
      fs = makeFakeFs({
        [`${STATE_DIR}/192.168.1.5.cert.pem`]: 'C',
        [`${STATE_DIR}/192.168.1.5.key.pem`]: 'K',
      });
      store = new AndroidTvCertStore(fs, paths, logger, generator);
      await store.migrate('192.168.1.5', 'AA:BB:CC:DD:EE:FF');
      const dump = fs.dump();
      expect(dump[`${STATE_DIR}/AA_BB_CC_DD_EE_FF.cert.pem`]).toBe('C');
      expect(dump[`${STATE_DIR}/AA_BB_CC_DD_EE_FF.key.pem`]).toBe('K');
      expect(dump[`${STATE_DIR}/192.168.1.5.cert.pem`]).toBeUndefined();
      expect(dump[`${STATE_DIR}/192.168.1.5.key.pem`]).toBeUndefined();
      expect(logger.info.mock.calls).toContainEqual([
        'androidTvCertStore',
        'Migrated persisted client certificate',
        { oldCertKey: '192.168.1.5', newCertKey: 'AA:BB:CC:DD:EE:FF' },
      ]);
    });

    it('deletes old files when new key already has a pair (new wins)', async () => {
      fs = makeFakeFs({
        [`${STATE_DIR}/192.168.1.5.cert.pem`]: 'OLD_C',
        [`${STATE_DIR}/192.168.1.5.key.pem`]: 'OLD_K',
        [`${STATE_DIR}/AA_BB_CC_DD_EE_FF.cert.pem`]: 'NEW_C',
        [`${STATE_DIR}/AA_BB_CC_DD_EE_FF.key.pem`]: 'NEW_K',
      });
      store = new AndroidTvCertStore(fs, paths, logger, generator);
      await store.migrate('192.168.1.5', 'AA:BB:CC:DD:EE:FF');
      const dump = fs.dump();
      expect(dump[`${STATE_DIR}/AA_BB_CC_DD_EE_FF.cert.pem`]).toBe('NEW_C');
      expect(dump[`${STATE_DIR}/AA_BB_CC_DD_EE_FF.key.pem`]).toBe('NEW_K');
      expect(dump[`${STATE_DIR}/192.168.1.5.cert.pem`]).toBeUndefined();
      expect(dump[`${STATE_DIR}/192.168.1.5.key.pem`]).toBeUndefined();
      // No "Migrated" log line — the new pair already existed.
      expect(logger.info.mock.calls).toHaveLength(0);
    });

    it('is silently a no-op when neither old nor new exists', async () => {
      await store.migrate('192.168.1.5', 'AA:BB:CC:DD:EE:FF');
      expect(fs.dump()).toEqual({});
      expect(logger.info.mock.calls).toHaveLength(0);
    });

    it('treats colon-sanitised duplicate keys as the same path', async () => {
      fs = makeFakeFs({
        [`${STATE_DIR}/AA_BB_CC.cert.pem`]: 'C',
        [`${STATE_DIR}/AA_BB_CC.key.pem`]: 'K',
      });
      store = new AndroidTvCertStore(fs, paths, logger, generator);
      // Different *literal* keys but sanitise to the same file paths → no-op.
      await store.migrate('AA:BB:CC', 'AA_BB_CC');
      const dump = fs.dump();
      expect(dump[`${STATE_DIR}/AA_BB_CC.cert.pem`]).toBe('C');
      expect(dump[`${STATE_DIR}/AA_BB_CC.key.pem`]).toBe('K');
    });
  });

  describe('clear', () => {
    it('removes both files for the key', async () => {
      fs = makeFakeFs({
        [`${STATE_DIR}/mac1.cert.pem`]: 'C',
        [`${STATE_DIR}/mac1.key.pem`]: 'K',
      });
      store = new AndroidTvCertStore(fs, paths, logger, generator);
      await store.clear('mac1');
      expect(fs.dump()).toEqual({});
    });

    it('is a no-op if files are already gone', async () => {
      await expect(store.clear('mac1')).resolves.toBeUndefined();
    });
  });
});
