import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { app, dialog, systemPreferences } from 'electron';

import { getRuntimeConfig } from '../backend/core/runtimeConfig';

/** Development-only OS boundaries. All mutable files belong to one isolated profile. */
export interface IntegrationConfig {
  schemaVersion: 1;
  pairingPort: number;
  remotePort: number;
  discoveryCommand: string;
  discoveryStatePath: string;
  /** Discovery scope only; connection/pairing providers remain registered. */
  discoveryPlatforms?: string[];
  systemStatePath: string;
  dialogStatePath: string;
  updater?: {
    releaseApiUrl: string;
    installedBundlePath: string;
    commandExecutable: string;
    relaunchStatePath: string;
  };
}
export interface IntegrationSystemState {
  loginSupported: boolean;
  login: boolean | null;
  loginGetError?: string;
  loginSetError?: string;
  microphone: 'granted' | 'denied';
}
export interface IntegrationDialogState {
  responses: number[];
  requests: Omit<Electron.MessageBoxOptions, 'icon'>[];
}

export function assertLoopbackHost(host: string): void {
  if (!/^127(?:\.\d{1,3}){3}$/.test(host) && host !== '::1' && host !== '[::1]') {
    throw new Error(`Integration endpoint must be a loopback address: ${host}`);
  }
  if (host.startsWith('127.') && host.split('.').some((part) => Number(part) > 255)) {
    throw new Error('Invalid loopback address');
  }
}
export function assertLoopbackUrl(value: string): void {
  const url = new URL(value);
  assertLoopbackHost(url.hostname);
  if (url.protocol !== 'http:' || url.username || url.password) {
    throw new Error('Integration HTTP endpoints must use unauthenticated loopback HTTP');
  }
}

function contained(root: string, value: string): void {
  if (!path.isAbsolute(value)) throw new Error('Integration paths must be absolute');
  const relative = path.relative(root, value);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Integration mutable path must be inside isolated userData: ${value}`);
  }
  // Reject symlink escapes, including a not-yet-created file with a symlink ancestor.
  let ancestor = value;
  for (;;) {
    try {
      const entry = fs.lstatSync(ancestor);
      if (entry.isSymbolicLink() && !fs.existsSync(ancestor)) {
        throw new Error('Integration path contains a dangling symlink');
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  const realRoot = fs.realpathSync(root);
  const realAncestor = fs.realpathSync(ancestor);
  if (realAncestor !== realRoot) {
    const realRelative = path.relative(realRoot, realAncestor);
    if (
      realRelative === '..' ||
      realRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelative)
    ) {
      throw new Error('Integration path escapes profile through a symlink');
    }
  }
}
function executable(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !path.isAbsolute(value))
    throw new Error('Expected absolute executable path');
  fs.accessSync(value, fs.constants.X_OK);
  if (!fs.statSync(value).isFile()) throw new Error('Fixture executable must be a file');
}
export function validateIntegrationConfig(value: unknown, root: string): IntegrationConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid integration configuration');
  const config = value as Record<string, unknown>;
  const allowed = [
    'schemaVersion',
    'pairingPort',
    'remotePort',
    'discoveryCommand',
    'discoveryStatePath',
    'systemStatePath',
    'discoveryPlatforms',
    'dialogStatePath',
    'updater',
  ];
  if (Object.keys(config).some((key) => !allowed.includes(key)) || config.schemaVersion !== 1)
    throw new Error('Invalid integration schema');
  const {
    pairingPort,
    remotePort,
    discoveryCommand,
    discoveryStatePath,
    systemStatePath,
    dialogStatePath,
  } = config;
  if (typeof pairingPort !== 'number' || typeof remotePort !== 'number')
    throw new Error('Invalid integration port');
  for (const port of [pairingPort, remotePort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Invalid integration port');
  }
  const discoveryPlatforms = config.discoveryPlatforms;
  if (
    discoveryPlatforms !== undefined &&
    (!Array.isArray(discoveryPlatforms) ||
      discoveryPlatforms.some((platform) => typeof platform !== 'string' || !platform.trim()))
  ) {
    throw new Error('Invalid integration discovery platforms');
  }
  executable(discoveryCommand);
  if (
    typeof discoveryStatePath !== 'string' ||
    typeof systemStatePath !== 'string' ||
    typeof dialogStatePath !== 'string'
  )
    throw new Error('Missing integration state path');
  for (const statePath of [discoveryStatePath, systemStatePath, dialogStatePath])
    contained(root, statePath);
  let updater: IntegrationConfig['updater'];
  if (config.updater !== undefined) {
    if (!config.updater || typeof config.updater !== 'object' || Array.isArray(config.updater))
      throw new Error('Invalid updater schema');
    const raw = config.updater as Record<string, unknown>;
    if (
      Object.keys(raw).some(
        (key) =>
          ![
            'releaseApiUrl',
            'installedBundlePath',
            'commandExecutable',
            'relaunchStatePath',
          ].includes(key)
      )
    )
      throw new Error('Invalid updater schema');
    const { releaseApiUrl, installedBundlePath, commandExecutable, relaunchStatePath } = raw;
    if (
      typeof releaseApiUrl !== 'string' ||
      typeof installedBundlePath !== 'string' ||
      typeof relaunchStatePath !== 'string'
    )
      throw new Error('Missing updater sandbox fields');
    assertLoopbackUrl(releaseApiUrl);
    executable(commandExecutable);
    contained(root, installedBundlePath);
    contained(root, relaunchStatePath);
    if (!installedBundlePath.endsWith('.app') || !fs.statSync(installedBundlePath).isDirectory())
      throw new Error('Expected sandbox .app bundle');
    updater = { releaseApiUrl, installedBundlePath, commandExecutable, relaunchStatePath };
  }
  return {
    schemaVersion: 1,
    pairingPort,
    remotePort,
    discoveryCommand,
    discoveryStatePath,
    systemStatePath,
    dialogStatePath,
    ...(discoveryPlatforms !== undefined
      ? { discoveryPlatforms: discoveryPlatforms as string[] }
      : {}),
    ...(updater ? { updater } : {}),
  };
}

function loadEnvironment(): IntegrationConfig | undefined {
  const configPath = getRuntimeConfig().integrationConfigPath;
  if (!configPath) return undefined;
  if (app.isPackaged)
    throw new Error('Integration configuration is forbidden in packaged applications');
  const rootArg = process.argv.find((arg) => arg.startsWith('--user-data-dir='));
  const root = rootArg?.slice('--user-data-dir='.length);
  if (!root || !path.isAbsolute(root) || !fs.statSync(root).isDirectory())
    throw new Error('Integration requires an explicit isolated --user-data-dir');
  const resolved = fs.realpathSync(root);
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const temporaryRelative = path.relative(temporaryRoot, resolved);
  if (
    !temporaryRelative ||
    temporaryRelative === '..' ||
    temporaryRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(temporaryRelative)
  ) {
    throw new Error(
      'Integration userData must be an isolated directory beneath the OS temporary directory'
    );
  }
  for (const forbidden of [app.getPath('appData'), os.homedir(), app.getAppPath()]) {
    if (resolved === path.resolve(forbidden))
      throw new Error('Integration profile must not be an application or user directory');
  }
  contained(root, configPath);
  const config = validateIntegrationConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')), root);
  app.setPath('userData', root);
  return config;
}
// Imported before stores/credentials initialize, so no file can reach the ordinary profile.
export const integrationEnvironment = loadEnvironment();

let integrationTrayMenu: Electron.Menu | undefined;
export function recordIntegrationTrayMenu(menu: Electron.Menu): void {
  if (!integrationEnvironment) throw new Error('Native tray observation requires integration mode');
  integrationTrayMenu = menu;
}
export function getIntegrationTrayMenu(): Electron.Menu {
  if (!integrationEnvironment || !integrationTrayMenu)
    throw new Error('Integration native tray menu is unavailable');
  return integrationTrayMenu;
}

export function assertIntegrationPath(value: string): void {
  if (integrationEnvironment) contained(app.getPath('userData'), value);
}

function publishFixtureState(target: string, value: object): void {
  assertIntegrationPath(target);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`
  );
  assertIntegrationPath(temporary);
  const serialized = JSON.stringify(value);
  let created = false;
  try {
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    created = true;
    try {
      fs.writeFileSync(descriptor, serialized);
    } finally {
      fs.closeSync(descriptor);
    }
    assertIntegrationPath(target);
    fs.renameSync(temporary, target);
  } finally {
    if (created) fs.rmSync(temporary, { force: true });
  }
}

function readSystemState(): IntegrationSystemState {
  if (!integrationEnvironment) throw new Error('Native system fixture requires integration mode');
  const state = JSON.parse(
    fs.readFileSync(integrationEnvironment.systemStatePath, 'utf8')
  ) as IntegrationSystemState;
  if (
    typeof state.loginSupported !== 'boolean' ||
    (state.login !== null && typeof state.login !== 'boolean') ||
    !['granted', 'denied'].includes(state.microphone)
  )
    throw new Error('Invalid integration system state');
  return state;
}
export function loginSupported(): boolean {
  return integrationEnvironment
    ? readSystemState().loginSupported
    : process.platform === 'darwin' && app.isPackaged;
}
export function getLogin(): boolean {
  if (!integrationEnvironment) return app.getLoginItemSettings().openAtLogin;
  const state = readSystemState();
  if (state.loginGetError) throw new Error(state.loginGetError);
  if (state.login === null) throw new Error('Native login state is unknown');
  return state.login;
}
export function setLogin(enabled: boolean): void {
  if (!integrationEnvironment) {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return;
  }
  const state = readSystemState();
  if (state.loginSetError) throw new Error(state.loginSetError);
  state.login = enabled;
  publishFixtureState(integrationEnvironment.systemStatePath, state);
}
export async function microphoneGranted(): Promise<boolean> {
  return integrationEnvironment
    ? readSystemState().microphone === 'granted'
    : process.platform !== 'darwin' || systemPreferences.askForMediaAccess('microphone');
}
export async function showMessageBox(
  options: Electron.MessageBoxOptions,
  parent?: Electron.BrowserWindow
): Promise<Electron.MessageBoxReturnValue> {
  if (!integrationEnvironment)
    return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
  const state = JSON.parse(
    fs.readFileSync(integrationEnvironment.dialogStatePath, 'utf8')
  ) as IntegrationDialogState;
  if (!Array.isArray(state.responses) || !Array.isArray(state.requests))
    throw new Error('Invalid dialog fixture state');
  const { icon: _icon, ...request } = options;
  state.requests.push(request);
  const response = state.responses.shift();
  publishFixtureState(integrationEnvironment.dialogStatePath, state);
  if (
    typeof response !== 'number' ||
    !Number.isInteger(response) ||
    response < 0 ||
    response >= (options.buttons?.length ?? 1)
  ) {
    throw new Error('Missing or invalid native dialog response');
  }
  return { response, checkboxChecked: false };
}
let runningVersion: string | undefined;
export function updaterVersion(): string {
  if (!integrationEnvironment?.updater) return app.getVersion();
  runningVersion ??= readInstalledBundleVersion();
  return runningVersion;
}

function readInstalledBundleVersion(): string {
  if (!integrationEnvironment?.updater) return app.getVersion();
  const plist = fs.readFileSync(
    path.join(integrationEnvironment.updater.installedBundlePath, 'Contents', 'Info.plist'),
    'utf8'
  );
  const version = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(
    plist
  )?.[1];
  if (!version) throw new Error('Sandbox installed bundle is missing version metadata');
  return version;
}
export function updaterTemporaryDirectory(): string {
  if (!integrationEnvironment) return os.tmpdir();
  const directory = path.join(app.getPath('userData'), 'update-tmp');
  assertIntegrationPath(directory);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}
export async function runNativeCommand(command: string, args: string[]): Promise<void> {
  const fixture = integrationEnvironment?.updater;
  if (integrationEnvironment && !fixture)
    throw new Error('Integration native updater requires sandbox configuration');
  if (fixture) {
    if (!['ditto', 'xattr', 'rm', 'open'].includes(command))
      throw new Error('Unsupported sandbox native command');
    if (command === 'open') {
      const url: string | undefined = args.at(0);
      if (args.length !== 1 || typeof url !== 'string')
        throw new Error('Expected one loopback external URL');
      assertLoopbackUrl(url);
    }
    for (const argument of args.filter((argument) => path.isAbsolute(argument)))
      contained(app.getPath('userData'), argument);
    await promisify(execFile)(fixture.commandExecutable, [command, ...args], {
      env: { ...process.env, GTV_INTEGRATION_USER_DATA: app.getPath('userData') },
    });
  } else {
    await promisify(execFile)(command, args);
  }
}
export function relaunchUpdatedApp(): void {
  const fixture = integrationEnvironment?.updater;
  if (fixture)
    publishFixtureState(fixture.relaunchStatePath, {
      requested: true,
      installedBundlePath: fixture.installedBundlePath,
      version: readInstalledBundleVersion(),
    });
  else app.relaunch();
  app.quit();
}
