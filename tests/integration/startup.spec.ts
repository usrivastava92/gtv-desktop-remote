import { spawn } from 'node:child_process';
import { readFile, readlink, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { test, expect, repository } from './app-harness';

test('STARTUP-BOOTSTRAP: built renderer, preload capability/status and acknowledged native hint', async ({
  harness: h,
}) => {
  const bootstrap = await h.api('bootstrap');
  expect(bootstrap.devices).toEqual([]);
  expect(bootstrap.deviceState.status).toBe('idle');
  expect(await h.api('capabilities')).toEqual({
    textInput: false,
    powerToggle: false,
    supportedCommands: [],
    assistantVoice: false,
  });
  const state = JSON.parse(await readFile(path.join(h.profile, 'onboarding.json'), 'utf8'));
  expect(state.acknowledged).toBe(true);
  const dialogs = JSON.parse(await readFile(path.join(h.profile, 'dialogs.json'), 'utf8'));
  expect(dialogs.requests).toHaveLength(1);
  expect(dialogs.requests[0].buttons).toEqual(['Got it']);
  await h.restart();
  expect(
    JSON.parse(await readFile(path.join(h.profile, 'dialogs.json'), 'utf8')).requests
  ).toHaveLength(1);
});

test('STARTUP-INTERRUPTED-HINT: absent acknowledgement repeats native hint next launch', async ({
  harness: h,
}) => {
  await h.app.close();
  await rm(path.join(h.profile, 'onboarding.json'));
  await h.dialogs([]);
  await h.launch();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(path.join(h.profile, 'dialogs.json'), 'utf8')).requests.length
    )
    .toBe(2);
  await expect(readFile(path.join(h.profile, 'onboarding.json'), 'utf8')).rejects.toThrow();
  await h.dialogs([0]);
  await h.restart();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(path.join(h.profile, 'onboarding.json'), 'utf8')).acknowledged
    )
    .toBe(true);
});

test('STARTUP-SINGLETON: actual second Electron process foregrounds existing window and exits', async ({
  harness: h,
}, testInfo) => {
  const first = await h.app.evaluate(({ app, BrowserWindow }) => ({
    executable: process.execPath,
    argv: process.argv,
    cwd: process.cwd(),
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    hasLock: app.hasSingleInstanceLock(),
    windowId: BrowserWindow.getAllWindows()[0].id,
    environment: {
      GTV_INTEGRATION_CONFIG: process.env.GTV_INTEGRATION_CONFIG,
      GTV_REMOTE_DEBUG: process.env.GTV_REMOTE_DEBUG,
      GTV_CAPTURE: process.env.GTV_CAPTURE,
      nodeOptionsPresent: process.env.NODE_OPTIONS !== undefined,
      runAsNodePresent: process.env.ELECTRON_RUN_AS_NODE !== undefined,
    },
  }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GTV_INTEGRATION_CONFIG: first.environment.GTV_INTEGRATION_CONFIG,
    GTV_REMOTE_DEBUG: first.environment.GTV_REMOTE_DEBUG,
    GTV_CAPTURE: first.environment.GTV_CAPTURE,
  };
  // Playwright removes NODE_OPTIONS before launching Electron; raw spawn must do likewise.
  delete env.NODE_OPTIONS;
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  expect(
    await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
  ).toBe(false);
  const second = spawn(first.executable, first.argv.slice(1), {
    cwd: first.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let launchError: string | undefined;
  second.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout = (stdout + chunk).slice(-16_384);
  });
  second.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-16_384);
  });
  second.once('error', (error) => {
    launchError = error.message;
  });
  try {
    expect(first.hasLock).toBe(true);
    expect(first.userData).toBe(h.profile);
    expect(first.argv[1]).toBe(repository);
    await expect
      .poll(() =>
        h.app.evaluate(({ BrowserWindow }, windowId) => {
          const windows = BrowserWindow.getAllWindows();
          const window = windows.find((window) => window.id === windowId);
          return {
            count: windows.length,
            visible: window?.isVisible() ?? false,
            focused: window?.isFocused() ?? false,
          };
        }, first.windowId)
      )
      .toEqual({ count: 1, visible: true, focused: true });
    await expect
      .poll(() => ({ error: launchError, exitCode: second.exitCode, signal: second.signalCode }))
      .toEqual({ error: undefined, exitCode: 0, signal: null });
  } finally {
    // Never attach credential files, environment dumps or application payload logs.
    const sanitizeOutput = (value: string) =>
      value
        .replace(/-----BEGIN [^-]+-----[\s\S]*?(?:-----END [^-]+-----|$)/g, '[redacted PEM]')
        .split('\n')
        .map((line) =>
          /^\[\d{4}-\d{2}-\d{2}T/.test(line) ||
          /credential|private.?key|certificate|pairing|password|token|secret/i.test(line)
            ? '[redacted application log]'
            : line.replace(/[A-Za-z0-9+/=_-]{40,}/g, '[redacted token]')
        )
        .join('\n');
    const lockPaths = await Promise.all(
      ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].map(async (name) => {
        const file = path.join(first.userData, name);
        try {
          return { path: file, target: await readlink(file) };
        } catch (error) {
          return { path: file, error: (error as NodeJS.ErrnoException).code };
        }
      })
    );
    await testInfo
      .attach('singleton-launch-diagnostics', {
        body: JSON.stringify(
          {
            first: {
              ...first,
              argv: first.argv.map((arg) =>
                arg === first.executable ||
                arg === repository ||
                arg.startsWith('--user-data-dir=') ||
                arg.startsWith('--use-file-for-fake-audio-capture=') ||
                /^--(?:use-fake-ui-for-media-stream|use-fake-device-for-media-stream|disable-background-networking|no-sandbox)$/.test(
                  arg
                )
                  ? arg
                  : '[redacted argument]'
              ),
            },
            second: {
              pid: second.pid,
              exitCode: second.exitCode,
              signal: second.signalCode,
              error: launchError && sanitizeOutput(launchError),
              nodeOptionsPresent: env.NODE_OPTIONS !== undefined,
              inheritedNodeOptionsPresent: process.env.NODE_OPTIONS !== undefined,
              stdout: sanitizeOutput(stdout),
              stderr: sanitizeOutput(stderr),
            },
            lockPaths,
          },
          null,
          2
        ),
        contentType: 'application/json',
      })
      .finally(() => {
        if (second.exitCode === null) second.kill();
      });
  }
});

test('IPC-ARGUMENTS: production preload rejects malformed device, preference and voice requests', async ({
  harness: h,
}) => {
  const results = await h.page.evaluate(async () => {
    const api = window.gtvRemote;
    const invalid: [string, unknown[]][] = [
      ['saveDevice', [{ name: '', host: 'not a host', adbPort: -1 }]],
      ['changePreference', [{ launchAtLogin: 'yes' }]],
      ['setShortcutCapture', ['true']],
      ['sendText', [42]],
      ['sendAssistantVoiceChunk', [-1, '!!!']],
      ['sendCommand', [{ command: 'launch-shell' }]],
    ];
    return Promise.all(
      invalid.map(async ([name, args]) => {
        const callable = Reflect.get(api, name);
        try {
          const result: unknown = await Reflect.apply(callable, api, args);
          return (
            result !== null &&
            typeof result === 'object' &&
            'error' in result &&
            typeof result.error === 'string'
          );
        } catch {
          return true;
        }
      })
    );
  });
  expect(results.every(Boolean)).toBe(true);
  expect((await h.api('bootstrap')).devices).toEqual([]);
});

test('IPC-UNTRUSTED-SENDER: foreign file renderer cannot invoke app operations', async ({
  harness: h,
}) => {
  const foreign = path.join(h.profile, 'foreign.html');
  await writeFile(foreign, '<!doctype html><title>Synthetic foreign sender</title>');
  await h.app.evaluate(async ({ app, BrowserWindow }, file) => {
    const foreignWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: `${app.getAppPath()}/dist-electron/main/preload.js`,
        contextIsolation: true,
        sandbox: false,
      },
    });
    await foreignWindow.loadFile(file);
  }, foreign);
  const page = h.app.windows().find((page) => page.url().endsWith('foreign.html'));
  if (!page) throw new Error('Foreign renderer did not launch');
  await expect(page.evaluate(() => window.gtvRemote.bootstrap())).rejects.toThrow();
  expect((await h.api('bootstrap')).devices).toEqual([]);
  await page.close();
});

test('TRAY-SHOW-HIDE: real installed native menu callbacks control actual window', async ({
  harness: h,
}) => {
  const hidden = await h.trayAction('hide-remote');
  expect(hidden.id).toBe('hide-remote');
  expect(
    await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
  ).toBe(false);
  const shown = await h.trayAction('show-remote');
  expect(shown.id).toBe('show-remote');
  await expect
    .poll(() => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true);
  expect((await h.api('bootstrap')).deviceState.status).toBe('idle');
});

test('TRAY-QUIT: real native menu selection terminates actual app process', async ({
  harness: h,
}) => {
  const process = h.app.process();
  const exited = new Promise<number | null>((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', resolve);
  });
  await h.trayAction('quit').catch((error: unknown) => {
    if (
      !(error instanceof Error) ||
      !/Target.*closed|Application.*closed|connection.*closed/i.test(error.message)
    )
      throw error;
  });
  expect(await exited).toBe(0);
});
