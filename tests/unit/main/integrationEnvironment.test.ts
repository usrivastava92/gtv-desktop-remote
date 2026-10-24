import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isPackaged: false,
  profile: '/ordinary-profile',
  setPath: vi.fn(),
  quit: vi.fn(),
  relaunch: vi.fn(),
  showMessageBox: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return native.isPackaged;
    },
    getPath: (name: string) => (name === 'userData' ? native.profile : '/ordinary-app-data'),
    getAppPath: () => '/repo',
    setPath: (name: string, value: string) => {
      native.setPath(name, value);
      native.profile = value;
    },
    getVersion: () => '1.0.0',
    quit: native.quit,
    relaunch: native.relaunch,
  },
  dialog: { showMessageBox: native.showMessageBox },
  systemPreferences: { askForMediaAccess: vi.fn().mockResolvedValue(true) },
}));

let root: string;
const originalArgv = [...process.argv];
let config: {
  schemaVersion: 1;
  pairingPort: number;
  remotePort: number;
  discoveryCommand: string;
  discoveryStatePath: string;
  systemStatePath: string;
  dialogStatePath: string;
  updater?: {
    releaseApiUrl: string;
    installedBundlePath: string;
    commandExecutable: string;
    relaunchStatePath: string;
  };
};
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('GTV_INTEGRATION_CONFIG', '');
  native.isPackaged = false;
  native.profile = '/ordinary-profile';
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gtv-integration-boundary-'));
  const command = path.join(root, 'command');
  fs.writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  config = {
    schemaVersion: 1,
    pairingPort: 18001,
    remotePort: 18002,
    discoveryCommand: command,
    discoveryStatePath: path.join(root, 'discovery.json'),
    systemStatePath: path.join(root, 'system.json'),
    dialogStatePath: path.join(root, 'dialogs.json'),
  };
  fs.writeFileSync(
    config.systemStatePath,
    JSON.stringify({ loginSupported: true, login: false, microphone: 'granted' })
  );
  fs.writeFileSync(config.dialogStatePath, JSON.stringify({ responses: [0, 1], requests: [] }));
});
afterEach(() => {
  process.argv = [...originalArgv];
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
async function loadFixture() {
  const configPath = path.join(root, 'integration.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  vi.stubEnv('GTV_INTEGRATION_CONFIG', configPath);
  process.argv = [...originalArgv, `--user-data-dir=${root}`];
  return import('../../../src/main/integrationEnvironment.js');
}

// Dynamic imports intentionally exercise module-load opt-in, which a static import cannot repeat.
describe('isolated integration OS boundaries', () => {
  it('keeps the ordinary profile and app version unchanged without opt-in', async () => {
    const environment = await import('../../../src/main/integrationEnvironment.js');
    expect(environment.integrationEnvironment).toBeUndefined();
    expect(environment.updaterVersion()).toBe('1.0.0');
    expect(() => environment.getIntegrationTrayMenu()).toThrow('unavailable');
    expect(native.setPath).not.toHaveBeenCalled();
  });
  it('rejects packaged opt-in before changing any profile', async () => {
    native.isPackaged = true;
    await expect(loadFixture()).rejects.toThrow('forbidden');
    expect(native.setPath).not.toHaveBeenCalled();
  });
  it('rejects opt-in without an explicitly isolated profile', async () => {
    const configPath = path.join(root, 'integration.json');
    fs.writeFileSync(configPath, JSON.stringify(config));
    vi.stubEnv('GTV_INTEGRATION_CONFIG', configPath);
    process.argv = [...originalArgv];
    await expect(import('../../../src/main/integrationEnvironment.js')).rejects.toThrow(
      'explicit isolated'
    );
    expect(native.setPath).not.toHaveBeenCalled();
  });
  it('validates schema, ports, loopback addresses and sandbox containment', async () => {
    const environment = await import('../../../src/main/integrationEnvironment.js');
    expect(environment.validateIntegrationConfig(config, root)).toEqual(config);
    expect(() => environment.validateIntegrationConfig({ ...config, remotePort: 0 }, root)).toThrow(
      'port'
    );
    expect(() =>
      environment.validateIntegrationConfig({ ...config, schemaVersion: 2 }, root)
    ).toThrow('schema');
    expect(() =>
      environment.validateIntegrationConfig(
        { ...config, systemStatePath: '/Applications/state' },
        root
      )
    ).toThrow('inside isolated');
    for (const url of [
      'https://127.0.0.1/release',
      'http://example.com/release',
      'http://127.0.0.999/release',
      'http://user@127.0.0.1/release',
    ]) {
      expect(() => {
        environment.assertLoopbackUrl(url);
      }).toThrow();
    }
    expect(() => {
      environment.assertLoopbackUrl('http://127.0.0.2:8080/release');
    }).not.toThrow();
  });
  it('accepts explicit discovery scope and rejects malformed platform lists', async () => {
    const environment = await import('../../../src/main/integrationEnvironment.js');
    expect(
      environment.validateIntegrationConfig(
        {
          ...config,
          discoveryPlatforms: ['google-tv', 'fire-tv'],
        },
        root
      ).discoveryPlatforms
    ).toEqual(['google-tv', 'fire-tv']);
    expect(environment.validateIntegrationConfig(config, root).discoveryPlatforms).toBeUndefined();
    for (const discoveryPlatforms of ['google-tv', [1], ['']]) {
      expect(() =>
        environment.validateIntegrationConfig(
          {
            ...config,
            discoveryPlatforms,
          },
          root
        )
      ).toThrow('discovery platforms');
    }
  });
  it('rejects symlink escapes even when the state file does not yet exist', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gtv-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, 'escape'));
      const environment = await import('../../../src/main/integrationEnvironment.js');
      expect(() =>
        environment.validateIntegrationConfig(
          { ...config, dialogStatePath: path.join(root, 'escape', 'new.json') },
          root
        )
      ).toThrow('symlink');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it('rejects scratch directory and dangling scratch symlinks before creating external files', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gtv-scratch-outside-'));
    try {
      const environment = await loadFixture();
      const scratch = path.join(root, 'update-tmp');
      fs.symlinkSync(outside, scratch);
      expect(() => environment.updaterTemporaryDirectory()).toThrow('symlink');
      expect(fs.readdirSync(outside)).toEqual([]);
      fs.unlinkSync(scratch);
      const missing = path.join(outside, 'not-created');
      fs.symlinkSync(missing, scratch);
      expect(() => environment.updaterTemporaryDirectory()).toThrow('dangling symlink');
      expect(fs.existsSync(missing)).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it('rejects final ZIP symlinks before requesting or writing an update', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gtv-zip-outside-'));
    try {
      const environment = await loadFixture();
      const updater = await import('../../../src/main/updater.js');
      const destination = path.join(environment.updaterTemporaryDirectory(), 'update.zip');
      const external = path.join(outside, 'user-file');
      fs.writeFileSync(external, 'untouched');
      fs.symlinkSync(external, destination);
      await expect(
        updater.downloadFile('http://127.0.0.1:1/asset', destination, () => undefined)
      ).rejects.toThrow('symlink');
      expect(fs.readFileSync(external, 'utf8')).toBe('untouched');
      fs.unlinkSync(destination);
      const missing = path.join(outside, 'not-created.zip');
      fs.symlinkSync(missing, destination);
      await expect(
        updater.downloadFile('http://127.0.0.1:1/asset', destination, () => undefined)
      ).rejects.toThrow('dangling symlink');
      expect(fs.existsSync(missing)).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it('revalidates the final download path after real HTTP progress before writing', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gtv-progress-outside-'));
    const server = createServer((_request, response) => {
      response.end('real fixture download');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing loopback server address');
      const environment = await loadFixture();
      const updater = await import('../../../src/main/updater.js');
      const destination = path.join(environment.updaterTemporaryDirectory(), 'update.zip');
      const external = path.join(outside, 'user-file');
      fs.writeFileSync(external, 'untouched');
      await expect(
        updater.downloadFile(`http://127.0.0.1:${String(address.port)}/asset`, destination, () => {
          if (!fs.existsSync(destination)) fs.symlinkSync(external, destination);
        })
      ).rejects.toThrow('symlink');
      expect(fs.readFileSync(external, 'utf8')).toBe('untouched');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        })
      );
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it('consumes queued semantic choices and records native requests, never inventing responses', async () => {
    const environment = await loadFixture();
    expect(native.profile).toBe(root);
    expect(
      (
        await environment.showMessageBox({
          buttons: ['Install', 'Later'],
          title: 'Available',
          message: 'Install available update?',
        })
      ).response
    ).toBe(0);
    expect(
      (
        await environment.showMessageBox({
          buttons: ['Relaunch', 'Later'],
          message: 'Relaunch installed update?',
        })
      ).response
    ).toBe(1);
    await expect(
      environment.showMessageBox({ buttons: ['OK'], message: 'Update complete.' })
    ).rejects.toThrow('Missing or invalid');
    const state: unknown = JSON.parse(fs.readFileSync(config.dialogStatePath, 'utf8'));
    if (
      !state ||
      typeof state !== 'object' ||
      !('requests' in state) ||
      !Array.isArray(state.requests)
    )
      throw new Error('Missing recorded native dialog requests');
    const requests: unknown[] = state.requests;
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({ buttons: ['Install', 'Later'] });
    expect(native.showMessageBox).not.toHaveBeenCalled();
  });
  it('publishes native dialog state as a complete same-directory replacement', async () => {
    const environment = await loadFixture();
    const previous = fs.readFileSync(config.dialogStatePath, 'utf8');
    const originalRename = fs.renameSync;
    let observed = false;
    const observer = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      expect(path.dirname(String(source))).toBe(path.dirname(String(destination)));
      expect(fs.readFileSync(destination, 'utf8')).toBe(previous);
      const next: unknown = JSON.parse(fs.readFileSync(source, 'utf8'));
      expect(next).toMatchObject({
        responses: [1],
        requests: [{ buttons: ['Install', 'Later'], message: 'Install available update?' }],
      });
      observed = true;
      originalRename(source, destination);
    });
    try {
      await environment.showMessageBox({
        buttons: ['Install', 'Later'],
        message: 'Install available update?',
      });
      expect(observed).toBe(true);
      const published: unknown = JSON.parse(fs.readFileSync(config.dialogStatePath, 'utf8'));
      expect(published).toMatchObject({ responses: [1] });
      expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      observer.mockRestore();
    }
  });
  it('preserves complete prior native state and cleans scratch files when publication fails', async () => {
    const environment = await loadFixture();
    const previous = fs.readFileSync(config.systemStatePath, 'utf8');
    const failedRename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('Native state publication failed');
    });
    try {
      expect(() => {
        environment.setLogin(true);
      }).toThrow('Native state publication failed');
      expect(fs.readFileSync(config.systemStatePath, 'utf8')).toBe(previous);
      expect(environment.getLogin()).toBe(false);
      expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      failedRename.mockRestore();
    }
  });
  it('leaves a competing temporary file intact when exclusive publication creation fails', async () => {
    const environment = await loadFixture();
    const previous = fs.readFileSync(config.systemStatePath, 'utf8');
    const originalOpen = fs.openSync;
    let collision: string | undefined;
    const competingOpen = vi.spyOn(fs, 'openSync').mockImplementation((target, flags, mode) => {
      if (flags === 'wx') {
        collision = String(target);
        fs.writeFileSync(target, 'unrelated competing file');
      }
      return originalOpen(target, flags, mode);
    });
    try {
      expect(() => {
        environment.setLogin(true);
      }).toThrow('EEXIST');
      if (collision === undefined) throw new Error('Expected competing publication file');
      expect(fs.readFileSync(collision, 'utf8')).toBe('unrelated competing file');
      expect(fs.readFileSync(config.systemStatePath, 'utf8')).toBe(previous);
      expect(environment.getLogin()).toBe(false);
    } finally {
      competingOpen.mockRestore();
    }
  });
  it('reads native state afresh and preserves errors/unknown rather than reporting false success', async () => {
    const environment = await loadFixture();
    expect(environment.loginSupported()).toBe(true);
    expect(environment.getLogin()).toBe(false);
    environment.setLogin(true);
    expect(environment.getLogin()).toBe(true);
    expect(await environment.microphoneGranted()).toBe(true);
    fs.writeFileSync(
      config.systemStatePath,
      JSON.stringify({
        loginSupported: true,
        login: null,
        microphone: 'denied',
        loginSetError: 'fixture OS failure',
      })
    );
    expect(() => environment.getLogin()).toThrow('unknown');
    expect(() => {
      environment.setLogin(false);
    }).toThrow('fixture OS failure');
    expect(await environment.microphoneGranted()).toBe(false);
    await expect(
      environment.runNativeCommand('ditto', ['/Applications/User.app', path.join(root, 'copy.app')])
    ).rejects.toThrow('sandbox configuration');
  });
  it('reads installed bundle metadata on restart and records relaunch without spawning a user app', async () => {
    const bundle = path.join(root, 'Installed.app');
    fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true });
    const plistPath = path.join(bundle, 'Contents', 'Info.plist');
    fs.writeFileSync(plistPath, '<key>CFBundleShortVersionString</key><string>2.0.0</string>');
    config.updater = {
      releaseApiUrl: 'http://127.0.0.1:18003/latest',
      installedBundlePath: bundle,
      commandExecutable: config.discoveryCommand,
      relaunchStatePath: path.join(root, 'relaunch.json'),
    };
    const environment = await loadFixture();
    expect(environment.updaterVersion()).toBe('2.0.0');
    await expect(
      environment.runNativeCommand('ditto', [bundle, '/Applications/User.app'])
    ).rejects.toThrow('inside isolated');
    fs.writeFileSync(plistPath, '<key>CFBundleShortVersionString</key><string>3.0.0</string>');
    environment.relaunchUpdatedApp();
    expect(JSON.parse(fs.readFileSync(config.updater.relaunchStatePath, 'utf8'))).toEqual({
      requested: true,
      installedBundlePath: bundle,
      version: '3.0.0',
    });
    expect(native.relaunch).not.toHaveBeenCalled();
    expect(native.quit).toHaveBeenCalledOnce();
  });
});
