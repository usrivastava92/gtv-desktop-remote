import path from 'node:path';

import type { IFileSystem } from '../../core/fileSystem';
import { silentLogger, type ILogger } from '../../core/logger';
import type { IPathProvider } from '../../core/pathProvider';
import { generateCertificate, type PemPair } from '../../protocol/androidtv/certificate';

const SERVICE_NAME = 'gtv-desktop-remote';

/**
 * Persists and migrates the per-device client certificate pair that the
 * Android TV pairing protocol exchanges. Keyed by MAC address when known
 * (stable across IP changes), falling back to host.
 *
 * Extracted from `src/main/device/androidTvRemote.ts` as part of PR-3a.
 * The original singleton bridge now delegates to this class so behavior is
 * byte-for-byte identical for the running app, but the methods are now
 * unit-testable with a fake filesystem.
 *
 * **This class is a Google TV non-regression gate.** Any change to the
 * cert-on-disk layout, the migration logic on IP-change, or the safe-key
 * scheme breaks pairing for every user who upgrades. The tests under
 * `__tests__/androidTvCertStore.test.ts` lock down the contract.
 */
export class AndroidTvCertStore {
  constructor(
    private readonly fs: IFileSystem,
    private readonly paths: IPathProvider,
    private readonly logger: ILogger = silentLogger,
    private readonly generateCert: (commonName: string) => PemPair = generateCertificate
  ) {}

  /**
   * Returns the on-disk paths for a given cert key (MAC, host, or any other
   * stable identifier). Colons and slashes in the key are replaced with `_`
   * so the result is safe on every platform.
   */
  getFilesForCertKey(certKey: string): { certPath: string; keyPath: string } {
    const safeKey = certKey.replaceAll(':', '_').replaceAll('/', '_');
    const stateDir = this.paths.getCertStateDir();

    return {
      certPath: path.join(stateDir, `${safeKey}.cert.pem`),
      keyPath: path.join(stateDir, `${safeKey}.key.pem`),
    };
  }

  /**
   * Loads the cert pair for the given key. If no pair exists on disk a fresh
   * one is generated (via the injected generator) and persisted.
   */
  async loadOrCreate(certKey: string): Promise<PemPair> {
    const { certPath, keyPath } = this.getFilesForCertKey(certKey);

    if ((await this.fs.exists(certPath)) && (await this.fs.exists(keyPath))) {
      const [cert, key] = await Promise.all([
        this.fs.readFile(certPath, 'utf8'),
        this.fs.readFile(keyPath, 'utf8'),
      ]);
      return { cert, key };
    }

    const certs = this.generateCert(SERVICE_NAME);
    await this.fs.mkdir(this.paths.getCertStateDir(), { recursive: true });
    await Promise.all([
      this.fs.writeFile(certPath, certs.cert, 'utf8'),
      this.fs.writeFile(keyPath, certs.key, 'utf8'),
    ]);
    await this.logger.info('androidTvCertStore', 'Generated new client certificate', { certKey });
    return certs;
  }

  /**
   * Migrates the cert pair from `oldCertKey` to `newCertKey`. Used when a
   * device's IP changes (we re-key from host to MAC) or when we discover a
   * device by MAC for the first time. Behaviour matrix:
   *
   *   - keys identical            → no-op
   *   - new files already present → delete the old ones (the new pair wins)
   *   - new files absent          → rename the old ones into place
   *   - old files absent          → silent no-op (nothing to migrate)
   */
  async migrate(oldCertKey: string, newCertKey: string): Promise<void> {
    const oldFiles = this.getFilesForCertKey(oldCertKey);
    const newFiles = this.getFilesForCertKey(newCertKey);

    if (oldFiles.certPath === newFiles.certPath) {
      return;
    }

    if (await this.fs.exists(newFiles.certPath)) {
      await Promise.all([
        this.fs.rm(oldFiles.certPath, { force: true }),
        this.fs.rm(oldFiles.keyPath, { force: true }),
      ]);
      return;
    }

    try {
      await this.fs.mkdir(this.paths.getCertStateDir(), { recursive: true });
      await Promise.all([
        this.fs.rename(oldFiles.certPath, newFiles.certPath),
        this.fs.rename(oldFiles.keyPath, newFiles.keyPath),
      ]);
      await this.logger.info('androidTvCertStore', 'Migrated persisted client certificate', {
        oldCertKey,
        newCertKey,
      });
    } catch {
      // Old cert did not exist either — nothing to migrate. Silent on purpose
      // so users who pair a brand-new device do not see scary log lines.
    }
  }

  /**
   * Removes the cert pair for the given key. Best-effort: no error if the
   * files were already gone.
   */
  async clear(certKey: string): Promise<void> {
    const { certPath, keyPath } = this.getFilesForCertKey(certKey);
    await Promise.all([
      this.fs.rm(certPath, { force: true }),
      this.fs.rm(keyPath, { force: true }),
    ]);
  }
}
