import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
  mkdir,
  cp,
  rename,
  open,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  _electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

import type { DesktopApi } from '../../src/shared/desktopApi';

import { createTvEmulator, type TvEmulator } from './emulator/tv-emulator';

declare global {
  interface Window {
    gtvRemote: DesktopApi;
  }
}
export const repository = path.resolve(__dirname, '../..');
interface NativeMenuEnvironment {
  getIntegrationTrayMenu(): Electron.Menu;
}
export interface AppLaunchOptions {
  fakeMediaUi?: boolean;
}

interface NativeWindowObservation {
  at: number;
  event: string;
  windowId: number;
  focused: boolean;
  visible: boolean;
  defaultShortcutRegistered: boolean;
}
interface NativeObservations {
  __gtvNativeWindowEvents?: NativeWindowObservation[];
  __gtvDeniedMediaPermissions?: string[];
}

async function publishFixtureJson(target: string, value: unknown) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(value);
  let created = false;
  try {
    const descriptor = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      await descriptor.writeFile(serialized);
    } finally {
      await descriptor.close();
    }
    await rename(temporary, target);
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

export class AppHarness {
  app!: ElectronApplication;
  appProcess?: ChildProcess;
  page!: Page;
  readonly configPath: string;
  constructor(
    readonly profile: string,
    readonly tv: TvEmulator
  ) {
    this.configPath = path.join(profile, 'integration.json');
  }
  async initialize() {
    await writeFile(
      path.join(this.profile, 'system.json'),
      JSON.stringify({ loginSupported: true, login: false, microphone: 'granted' })
    );
    await writeFile(
      path.join(this.profile, 'dialogs.json'),
      JSON.stringify({ responses: [0], requests: [] })
    );
    const wav = Buffer.alloc(44 + 48_000 * 2 * 4);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48_000, 24);
    wav.writeUInt32LE(96_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < (wav.length - 44) / 2; i++)
      wav.writeInt16LE(Math.round(8191 * Math.sin((2 * Math.PI * 440 * i) / 48_000)), 44 + i * 2);
    await writeFile(path.join(this.profile, 'microphone.wav'), wav);
    await writeFile(
      this.configPath,
      JSON.stringify({
        schemaVersion: 1,
        pairingPort: this.tv.pairingPort,
        remotePort: this.tv.remotePort,
        discoveryCommand: path.join(repository, 'tests/integration/fixtures/bin/dns-sd.cjs'),
        discoveryStatePath: this.tv.discoveryStatePath,
        systemStatePath: path.join(this.profile, 'system.json'),
        dialogStatePath: path.join(this.profile, 'dialogs.json'),
      })
    );
    await this.tv.setDiscovery([
      {
        name: 'Synthetic TV',
        host: this.tv.host,
        port: this.tv.remotePort,
        txt: { bt: '02:00:00:00:00:01', fn: 'Synthetic TV', md: 'Synthetic protocol oracle' },
      },
    ]);
    await this.launch();
  }
  async launch(options: AppLaunchOptions = {}) {
    this.app = await _electron.launch({
      args: [
        repository,
        `--user-data-dir=${this.profile}`,
        ...(options.fakeMediaUi === false ? [] : ['--use-fake-ui-for-media-stream']),
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${path.join(this.profile, 'microphone.wav')}`,
        '--disable-background-networking',
        '--no-sandbox',
        ...(process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []),
      ],
      recordVideo: { dir: path.join(this.profile, 'videos'), size: { width: 360, height: 720 } },
      env: {
        ...process.env,
        GTV_INTEGRATION_CONFIG: this.configPath,
        GTV_REMOTE_DEBUG: '1',
        GTV_CAPTURE: '0',
      },
      timeout: 30_000,
    });
    // Playwright disposes its process channel on native quit; retain the real child handle.
    this.appProcess = this.app.process();
    this.page = await this.app.firstWindow();
    await this.app.evaluate(({ app, BrowserWindow, globalShortcut }) => {
      const fixture = globalThis as typeof globalThis & NativeObservations;
      const events: NativeWindowObservation[] = [];
      fixture.__gtvNativeWindowEvents = events;
      function observe(window: Electron.BrowserWindow) {
        const windowId = window.id;
        function record(event: string) {
          const destroyed = window.isDestroyed();
          events.push({
            at: Date.now(),
            event,
            windowId,
            focused: !destroyed && window.isFocused(),
            visible: !destroyed && window.isVisible(),
            defaultShortcutRegistered: globalShortcut.isRegistered('CommandOrControl+Shift+G'),
          });
        }
        record('observed');
        window.on('blur', () => record('blur'));
        window.on('focus', () => record('focus'));
        window.on('show', () => record('show'));
        window.on('hide', () => record('hide'));
        window.on('closed', () => record('closed'));
        window.on('unresponsive', () => record('unresponsive'));
        window.webContents.on('did-start-navigation', () => record('did-start-navigation'));
        window.webContents.on('render-process-gone', () => record('render-process-gone'));
      }
      BrowserWindow.getAllWindows().forEach(observe);
      app.on('browser-window-created', (_event, window) => observe(window));
    });
    await this.page.context().tracing.start({ screenshots: true, snapshots: true });
    await expect(this.page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    expect(new URL(this.page.url()).protocol).toBe('file:');
    // Finish the real renderer's initial scan before a case can replace native discovery input.
    await expect(
      this.page
        .getByRole('heading', { name: 'New Devices Found', exact: true })
        .locator('..')
        .getByRole('button')
    ).toBeEnabled();
    // Native show can precede observer attachment and the remote legitimately hides on blur.
    // Wait for real preference initialization before focus or capture can change ownership.
    await expect
      .poll(async () => {
        const preferences = await this.api('getPreferences');
        return preferences.activeShortcut !== null || preferences.shortcutError !== null;
      })
      .toBe(true);
    await this.focusNativeWindow();
  }
  async api<K extends keyof DesktopApi>(
    method: K,
    ...args: Parameters<DesktopApi[K]>
  ): Promise<Awaited<ReturnType<DesktopApi[K]>>> {
    return this.page.evaluate(
      async ({ method, args }) => {
        const api = window.gtvRemote;
        const callable = api[method] as (...values: unknown[]) => unknown;
        return await callable(...args);
      },
      { method, args }
    ) as Promise<Awaited<ReturnType<DesktopApi[K]>>>;
  }
  async certificate() {
    const credentialDirectory = path.join(this.profile, 'androidtvremote');
    const names = await readdir(credentialDirectory).catch(() => []);
    const filename = names.find((name) => name.endsWith('.cert.pem'));
    if (!filename) throw new Error('Actual app did not generate a client certificate');
    return readFile(path.join(credentialDirectory, filename), 'utf8');
  }
  async preparePairing(control: 'body' | 'plus' = 'body') {
    const row = this.page.getByRole('button').filter({ hasText: 'Synthetic TV' }).first();
    await expect(row).toBeVisible();
    if (control === 'plus') await row.locator('.ui-found-add').click();
    else await row.locator('.ui-found-main').click();
    await expect.poll(async () => (await this.api('bootstrap')).deviceState.status).toBe('error');
    await expect(this.page.locator('.ui-alert')).toBeVisible();
    await this.tv.trustClient(await this.certificate());
    await this.tv.start();
    const { devices } = await this.api('bootstrap');
    expect(devices).toHaveLength(1);
    return devices[0];
  }
  async openPairing(control: 'body' | 'plus' = 'body') {
    const row = this.page.locator('.ui-found-row').filter({ hasText: 'Synthetic TV' });
    await expect(row).toBeVisible();
    if (control === 'plus') await row.locator('.ui-found-add').click();
    else await row.locator('.ui-found-main').click();
    await expect(this.page.locator('input[autocomplete="one-time-code"]')).toBeVisible();
    expect((await this.api('bootstrap')).deviceState.status).toBe('idle');
    await expect.poll(() => this.tv.pairingCode).toMatch(/^[0-9A-Fa-f]{6}$/);
  }
  async pair(control: 'body' | 'plus' = 'body') {
    const device = await this.preparePairing(control);
    await this.openPairing(control);
    await this.page.locator('input[autocomplete="one-time-code"]').fill(this.tv.pairingCode);
    await this.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await this.tv.waitFor((state) => state.ready);
    await expect(this.page.getByRole('button', { name: 'Select', exact: true })).toBeEnabled();
    return device;
  }
  async restart(options: AppLaunchOptions = {}) {
    await this.page.context().tracing.stop();
    await this.app.close();
    await this.launch(options);
  }
  async system(values: Record<string, unknown>) {
    const target = path.join(this.profile, 'system.json');
    await publishFixtureJson(target, {
      ...JSON.parse(await readFile(target, 'utf8')),
      ...values,
    });
  }
  async dialogs(responses: number[]) {
    const target = path.join(this.profile, 'dialogs.json');
    const value = JSON.parse(await readFile(target, 'utf8'));
    await publishFixtureJson(target, { ...value, responses });
  }
  async reconnectFromDevicePicker() {
    await this.api('disconnect');
    await this.page.getByRole('button', { name: "Don't see your device?", exact: true }).click();
    const saved = this.page.locator('.ui-card').filter({ hasText: 'Synthetic TV' });
    await expect(saved).toBeEnabled();
    await saved.click();
    await expect(this.page.getByRole('button', { name: 'Select', exact: true })).toBeEnabled();
  }
  async nativeObservations() {
    return this.app.evaluate(() => {
      const fixture = globalThis as typeof globalThis & NativeObservations;
      return {
        windows: fixture.__gtvNativeWindowEvents ?? [],
        deniedMediaPermissions: fixture.__gtvDeniedMediaPermissions ?? [],
      };
    });
  }
  async focusNativeWindow() {
    await this.trayAction('show-remote');
    await this.app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      BrowserWindow.getAllWindows()[0].focus();
    });
    await expect
      .poll(() =>
        this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())
      )
      .toBe(true);
  }
  async trayAction(id: 'show-remote' | 'hide-remote' | 'check-updates' | 'quit') {
    return this.app.evaluate(({ app, BrowserWindow }, selected) => {
      const loadModule = process
        .getBuiltinModule('module')
        .createRequire(`${app.getAppPath()}/package.json`);
      const environment: NativeMenuEnvironment = loadModule(
        `${app.getAppPath()}/dist-electron/main/integrationEnvironment.js`
      );
      const menu = environment.getIntegrationTrayMenu();
      const item = menu.getMenuItemById(selected);
      if (!item || !item.enabled || !item.visible)
        throw new Error(`Native menu choice unavailable: ${selected}`);
      item.click(item, BrowserWindow.getAllWindows()[0], { triggeredByAccelerator: false });
      return { id: item.id, label: item.label };
    }, id);
  }
}
export const test = base.extend<{ harness: AppHarness }>({
  harness: async ({}, runFixture, info) => {
    const profile = await mkdtemp(path.join(tmpdir(), 'gtv-functional-'));
    let tv: TvEmulator | undefined;
    let harness: AppHarness | undefined;
    let setupFailed = false;
    try {
      tv = await createTvEmulator({
        start: false,
        discoveryStatePath: path.join(profile, 'discovery.json'),
      });
      harness = new AppHarness(profile, tv);
      await harness.initialize();
      await runFixture(harness);
    } catch (error) {
      setupFailed = true;
      throw error;
    } finally {
      const failed = setupFailed || info.status !== info.expectedStatus;
      try {
        if (harness?.app) {
          try {
            const live = harness.appProcess?.exitCode === null;
            if (harness.page && failed) {
              await mkdir(info.outputDir, { recursive: true });
              if (live)
                await harness.page
                  .screenshot({ path: info.outputPath('failure.png') })
                  .catch(() => undefined);
              await info.attach('protocol-state', {
                body: JSON.stringify(tv?.snapshot()),
                contentType: 'application/json',
              });
              await info.attach('protocol-trace', {
                body: JSON.stringify(tv?.traces),
                contentType: 'application/json',
              });
              if (live) {
                await info.attach('native-window-events', {
                  body: JSON.stringify(await harness.nativeObservations()),
                  contentType: 'application/json',
                });
                const metrics = await harness.api('getMetricsSnapshot').catch(() => undefined);
                if (metrics)
                  await info.attach('command-metrics', {
                    body: JSON.stringify(metrics),
                    contentType: 'application/json',
                  });
              }
              if (live)
                await harness.page
                  .context()
                  .tracing.stop({ path: info.outputPath('trace.zip') })
                  .catch(() => undefined);
            } else if (harness.page && live)
              await harness.page
                .context()
                .tracing.stop()
                .catch(() => undefined);
          } finally {
            if (!harness.appProcess || harness.appProcess.exitCode === null)
              await harness.app.close().catch(() => undefined);
            if (failed) {
              await cp(path.join(profile, 'videos'), info.outputPath('videos'), {
                recursive: true,
              }).catch(() => undefined);
            }
          }
        }
      } finally {
        try {
          await tv?.stop();
        } finally {
          await rm(profile, { recursive: true, force: true });
        }
      }
    }
  },
});
export { expect };
