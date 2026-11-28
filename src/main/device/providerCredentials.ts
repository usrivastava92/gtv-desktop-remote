import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { app, safeStorage } from 'electron';

type Credentials = Record<string, string | undefined>;

/** Credentials never enter devices.json or renderer state. No plaintext fallback. */
export class ProviderCredentialStore {
  private pending: Promise<unknown> = Promise.resolve();

  private directory(): string {
    return path.join(app.getPath('userData'), 'provider-credentials');
  }

  private prefix(provider: string): string {
    if (!/^[a-z][a-z0-9-]*$/.test(provider)) throw new Error('Invalid credential provider');
    return `${provider}-`;
  }

  private file(provider: string, deviceId: string): string {
    const digest = createHash('sha256').update(deviceId).digest('hex');
    return path.join(this.directory(), `${this.prefix(provider)}${digest}.enc`);
  }

  assertAvailable(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    ) {
      throw new Error(
        'Secure credential storage is unavailable. Enable the operating system keychain before pairing.'
      );
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  read(provider: string, deviceId: string): Promise<Credentials | undefined> {
    return this.exclusive(async () => {
      let encrypted: Buffer;
      try {
        encrypted = await fs.readFile(this.file(provider, deviceId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new Error('Unable to read saved TV credentials.', { cause: error });
      }
      this.assertAvailable();
      try {
        const parsed: unknown = JSON.parse(safeStorage.decryptString(encrypted));
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          !Object.values(parsed).every((value) => typeof value === 'string')
        ) {
          throw new Error('Invalid credentials');
        }
        return parsed as Credentials;
      } catch {
        throw new Error(
          'Unable to decrypt saved TV credentials. Restore keychain access or forget and pair the TV again.'
        );
      }
    });
  }

  write(provider: string, deviceId: string, credentials: Credentials): Promise<void> {
    return this.exclusive(async () => {
      this.assertAvailable();
      const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
      const directory = this.directory();
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.chmod(directory, 0o700);
      const target = this.file(provider, deviceId);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
          await handle.chmod(0o600);
          await handle.writeFile(encrypted);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
  }

  remove(provider: string, deviceId: string): Promise<void> {
    return this.exclusive(() => fs.rm(this.file(provider, deviceId), { force: true }));
  }

  clear(provider: string): Promise<void> {
    return this.exclusive(async () => {
      const prefix = this.prefix(provider);
      let names: string[];
      try {
        names = await fs.readdir(this.directory());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      await Promise.all(
        names
          .filter((name) => name.startsWith(prefix))
          .map((name) => fs.rm(path.join(this.directory(), name), { force: true }))
      );
    });
  }
}

export const providerCredentials = new ProviderCredentialStore();
