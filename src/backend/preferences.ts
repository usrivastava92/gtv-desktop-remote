import path from 'node:path';

import type { AppPreferences, PreferenceResult } from '../shared/preferences';

import type { IFileSystem } from './core/fileSystem';

export const DEFAULT_SHOW_HIDE_SHORTCUT = 'CommandOrControl+Shift+G';

interface PreferencePlatform {
  isMac: boolean;
  register(shortcut: string): boolean;
  unregister(shortcut: string): void;
  loginSupported: boolean;
  getLogin(): boolean;
  setLogin(enabled: boolean): void;
}

/** Deliberately narrow accelerators: modifiers plus one letter, digit, or F key. */
export function normalizeShortcut(input: string): string {
  const aliases: Record<string, string> = {
    commandorcontrol: 'CommandOrControl',
    cmdorctrl: 'CommandOrControl',
    command: 'Command',
    cmd: 'Command',
    control: 'Control',
    ctrl: 'Control',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    super: 'Super',
  };
  const parts = input
    .trim()
    .split('+')
    .map((part) => part.trim());
  const key = parts.pop() ?? '';
  const modifiers = parts.map((part) => aliases[part.toLowerCase()]);
  if (
    modifiers.length === 0 ||
    modifiers.some((modifier) => !modifier) ||
    new Set(modifiers).size !== modifiers.length ||
    !modifiers.some((modifier) => modifier !== 'Shift') ||
    !/^(?:[a-z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/i.test(key)
  ) {
    throw new Error(
      'Use a modifier and a letter, digit, or F1–F24, for example CommandOrControl+Shift+G. Empty shortcuts are not allowed.'
    );
  }
  return [...modifiers, key.toUpperCase()].join('+');
}

export class PreferencesController {
  private state: AppPreferences;
  private queue: Promise<unknown> = Promise.resolve();
  private capturePaused = false;
  private captureShortcut: string | null = null;

  constructor(
    private readonly fs: IFileSystem,
    private readonly storePath: string,
    private readonly platform: PreferencePlatform
  ) {
    this.state = {
      shortcut: DEFAULT_SHOW_HIDE_SHORTCUT,
      activeShortcut: null,
      shortcutError: null,
      launchAtLogin: false,
      launchAtLoginError: null,
      launchAtLoginSupported: platform.loginSupported,
    };
  }

  getState(): AppPreferences {
    return { ...this.state };
  }

  async initialize(): Promise<void> {
    try {
      if (await this.fs.exists(this.storePath)) {
        const data: unknown = JSON.parse(await this.fs.readFile(this.storePath, 'utf8'));
        if (
          data &&
          typeof data === 'object' &&
          'shortcut' in data &&
          typeof data.shortcut === 'string'
        ) {
          this.state.shortcut = normalizeShortcut(data.shortcut);
        }
      }
    } catch {
      this.state.shortcutError =
        'Saved preferences could not be read. The default shortcut will be used; save a shortcut to repair preferences.';
    }
    try {
      if (this.platform.register(this.state.shortcut)) {
        this.state.activeShortcut = this.state.shortcut;
      } else {
        this.state.shortcutError =
          'Your saved shortcut is occupied by another app. Choose another shortcut in Settings; the menu bar still opens the remote.';
      }
    } catch {
      this.state.shortcutError =
        'Your saved shortcut could not be registered. Choose another shortcut in Settings; the menu bar still opens the remote.';
    }
    await this.refresh();
  }

  /** Serialized OS readback used whenever Settings opens, without changing Login Items. */
  refresh(): Promise<AppPreferences> {
    const operation = this.queue.then(async () => {
      if (this.platform.loginSupported) {
        const previous = this.state.launchAtLogin;
        try {
          const actual = this.readLogin();
          if (actual !== previous) await this.persist(this.state.shortcut, actual);
        } catch (error) {
          this.state.launchAtLoginError ??=
            error instanceof Error
              ? `The macOS login state was read, but could not be saved: ${error.message}`
              : 'The macOS login state could not be saved.';
        }
      }
      return this.getState();
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private readLogin(): boolean {
    try {
      const actual = this.platform.getLogin();
      this.state.launchAtLogin = actual;
      this.state.launchAtLoginError = null;
      return actual;
    } catch {
      this.state.launchAtLogin = null;
      this.state.launchAtLoginError =
        'macOS Login Items could not be read. Reopen Settings to retry; check System Settings → General → Login Items.';
      throw new Error(this.state.launchAtLoginError);
    }
  }

  change(input: unknown): Promise<PreferenceResult> {
    const operation = this.queue.then(() => this.apply(input));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  /** Recording temporarily releases only the shortcut this controller owns. */
  setShortcutCapture(input: unknown): Promise<PreferenceResult> {
    const operation = this.queue.then(() => {
      if (typeof input !== 'boolean') {
        return { preferences: this.getState(), error: 'Invalid shortcut capture request.' };
      }
      if (input === this.capturePaused) {
        return { preferences: this.getState(), error: null };
      }
      if (input) {
        this.captureShortcut = this.state.activeShortcut;
        if (this.captureShortcut) this.platform.unregister(this.captureShortcut);
        this.state.activeShortcut = null;
        this.capturePaused = true;
      } else {
        const shortcut = this.captureShortcut;
        this.capturePaused = false;
        this.captureShortcut = null;
        if (shortcut) {
          try {
            if (!this.platform.register(shortcut)) throw new Error('Shortcut unavailable');
            this.state.activeShortcut = shortcut;
          } catch {
            this.state.activeShortcut = null;
            this.state.shortcutError =
              'Your shortcut could not be restored after recording. It may now be occupied by another app. Save a shortcut in Settings; the menu bar still opens the remote.';
            return { preferences: this.getState(), error: this.state.shortcutError };
          }
        }
      }
      return { preferences: this.getState(), error: null };
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async persist(shortcut: string, launchAtLogin: boolean | null): Promise<void> {
    await this.fs.mkdir(path.dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.tmp`;
    await this.fs.writeFile(
      temporary,
      JSON.stringify({ shortcut, launchAtLogin }, null, 2),
      'utf8'
    );
    await this.fs.rename(temporary, this.storePath);
  }

  private nativeShortcutIdentity(shortcut: string): string {
    const parts = shortcut.split('+');
    const key = parts.pop() ?? '';
    const modifiers = parts.map((modifier) => {
      if (modifier === 'CommandOrControl') return this.platform.isMac ? 'Super' : 'Control';
      if (modifier === 'Command') return 'Super';
      return modifier;
    });
    return `${[...new Set(modifiers)].sort().join('+')}+${key}`;
  }

  private async apply(input: unknown): Promise<PreferenceResult> {
    try {
      if (this.capturePaused) throw new Error('Finish or cancel shortcut recording before saving.');
      if (!input || typeof input !== 'object' || Object.keys(input).length !== 1) {
        throw new Error('Choose either a shortcut or Launch at login.');
      }
      if ('shortcut' in input && typeof input.shortcut === 'string') {
        let shortcut = normalizeShortcut(input.shortcut);
        const previous = this.state.activeShortcut;
        if (
          previous &&
          this.nativeShortcutIdentity(shortcut) === this.nativeShortcutIdentity(previous)
        ) {
          // Keep the spelling of the owned binding: Electron treats aliases/order as one chord.
          shortcut = previous;
          await this.persist(shortcut, this.state.launchAtLogin);
        } else {
          // Register first: a failed replacement must not remove the working shortcut.
          if (!this.platform.register(shortcut)) {
            throw new Error(
              'That shortcut is unavailable or used by another app. Choose a different combination. Your previous shortcut has not changed.'
            );
          }
          try {
            await this.persist(shortcut, this.state.launchAtLogin);
          } catch (error) {
            this.platform.unregister(shortcut);
            throw error;
          }
          if (previous) this.platform.unregister(previous);
        }
        this.state.shortcut = shortcut;
        this.state.activeShortcut = shortcut;
        this.state.shortcutError = null;
      } else if ('launchAtLogin' in input && typeof input.launchAtLogin === 'boolean') {
        if (!this.platform.loginSupported) {
          throw new Error(
            'Launch at login is available only in the installed macOS app, not the development Electron executable.'
          );
        }
        const previous = this.readLogin();
        this.platform.setLogin(input.launchAtLogin);
        this.readLogin();
        if (this.state.launchAtLogin !== input.launchAtLogin) {
          throw new Error(
            'macOS did not apply Launch at login. Check System Settings → General → Login Items, then try again.'
          );
        }
        try {
          await this.persist(this.state.shortcut, this.state.launchAtLogin);
        } catch (error) {
          this.platform.setLogin(previous);
          this.readLogin();
          throw error;
        }
      } else {
        throw new Error('Invalid preference value.');
      }
      return { preferences: this.getState(), error: null };
    } catch (error) {
      return {
        preferences: this.getState(),
        error:
          error instanceof Error ? error.message : 'Preferences could not be saved. Try again.',
      };
    }
  }
}
