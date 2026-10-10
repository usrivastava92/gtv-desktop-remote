import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeFileSystem } from '../core/fileSystem';
import {
  DEFAULT_SHOW_HIDE_SHORTCUT,
  normalizeShortcut,
  PreferencesController,
} from '../preferences';

describe('launch and shortcut preferences', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'gtv-preferences-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function setup(loginSupported = true, isMac = true) {
    const occupied = new Set<string>();
    const registered = new Set<string>();
    const calls: string[] = [];
    let login = false;
    let denyLogin = false;
    let failReadback = false;
    const file = path.join(directory, 'preferences.json');
    function nativeChord(shortcut: string): string {
      let flags = 0;
      let key = '';
      for (const part of shortcut.split('+')) {
        switch (part) {
          case 'CommandOrControl':
            flags |= isMac ? 8 : 1;
            break;
          case 'Command':
          case 'Super':
            flags |= 8;
            break;
          case 'Control':
            flags |= 1;
            break;
          case 'Alt':
            flags |= 2;
            break;
          case 'Shift':
            flags |= 4;
            break;
          default:
            key = part.toUpperCase();
        }
      }
      return `${String(flags)}:${key}`;
    }
    const platform = {
      isMac,
      loginSupported,
      register: (shortcut: string) => {
        calls.push(`register:${shortcut}`);
        const chord = nativeChord(shortcut);
        if ([...occupied, ...registered].some((binding) => nativeChord(binding) === chord))
          return false;
        registered.add(shortcut);
        return true;
      },
      unregister: (shortcut: string) => {
        calls.push(`unregister:${shortcut}`);
        registered.delete(shortcut);
      },
      getLogin: () => {
        if (failReadback) throw new Error('OS unavailable');
        return login;
      },
      setLogin: (enabled: boolean) => {
        calls.push(`login:${String(enabled)}`);
        if (!denyLogin) login = enabled;
      },
    };
    const create = () => new PreferencesController(createNodeFileSystem(), file, platform);
    return {
      create,
      file,
      occupied,
      registered,
      calls,
      externalLogin: (enabled: boolean) => {
        login = enabled;
      },
      denyLogin: () => {
        denyLogin = true;
      },
      failReadback: (enabled: boolean) => {
        failReadback = enabled;
      },
    };
  }

  it('starts off, writes both preferences, and restores the custom shortcut after restart', async () => {
    const environment = setup();
    const controller = environment.create();
    await controller.initialize();
    expect(controller.getState().launchAtLogin).toBe(false);
    expect(environment.calls).not.toContain('login:true');
    expect((await controller.change({ launchAtLogin: true })).error).toBeNull();
    expect((await controller.change({ shortcut: 'Ctrl+Shift+r' })).error).toBeNull();
    expect(JSON.parse(await readFile(environment.file, 'utf8'))).toEqual({
      shortcut: 'Control+Shift+R',
      launchAtLogin: true,
    });
    environment.registered.clear();
    const restarted = environment.create();
    await restarted.initialize();
    expect(restarted.getState()).toMatchObject({
      activeShortcut: 'Control+Shift+R',
      launchAtLogin: true,
    });
    expect((await restarted.change({ launchAtLogin: false })).preferences.launchAtLogin).toBe(
      false
    );
  });

  it('registers replacement before removing the prior shortcut; conflict keeps prior usable', async () => {
    const environment = setup();
    const controller = environment.create();
    await controller.initialize();
    environment.occupied.add('Control+R');
    expect((await controller.change({ shortcut: 'Control+R' })).error).toContain('unavailable');
    expect(environment.registered.has(DEFAULT_SHOW_HIDE_SHORTCUT)).toBe(true);
    expect(controller.getState().shortcut).toBe(DEFAULT_SHOW_HIDE_SHORTCUT);
    expect((await controller.change({ shortcut: 'Control+T' })).error).toBeNull();
    expect(environment.calls.slice(-2)).toEqual([
      'register:Control+T',
      `unregister:${DEFAULT_SHOW_HIDE_SHORTCUT}`,
    ]);
    expect([...environment.registered]).toEqual(['Control+T']);
  });

  it.each([true, false])(
    'recaptures the owned default and reordered aliases without self-conflict on Mac=%s',
    async (isMac) => {
      const environment = setup(false, isMac);
      const controller = environment.create();
      await controller.initialize();
      await controller.setShortcutCapture(true);
      expect(environment.registered.size).toBe(0);
      await controller.setShortcutCapture(false);
      const beforeSave = environment.calls.length;
      const metaOrControl = isMac ? 'Super' : 'Control';
      const recaptured = await controller.change({ shortcut: `${metaOrControl}+Shift+G` });
      expect(recaptured.error).toBeNull();
      expect(recaptured.preferences.activeShortcut).toBe(DEFAULT_SHOW_HIDE_SHORTCUT);
      expect((await controller.change({ shortcut: `Shift+${metaOrControl}+G` })).error).toBeNull();
      if (isMac) {
        expect((await controller.change({ shortcut: 'Shift+Command+G' })).error).toBeNull();
      }
      expect(environment.calls).toHaveLength(beforeSave);
      expect(JSON.parse(await readFile(environment.file, 'utf8'))).toMatchObject({
        shortcut: DEFAULT_SHOW_HIDE_SHORTCUT,
      });
      expect([...environment.registered]).toEqual([DEFAULT_SHOW_HIDE_SHORTCUT]);

      // A genuinely different chord still registers first and retains the owned binding on conflict.
      environment.occupied.add('Alt+Control+R');
      expect((await controller.change({ shortcut: 'Control+Alt+R' })).error).toContain(
        'unavailable'
      );
      expect(controller.getState().activeShortcut).toBe(DEFAULT_SHOW_HIDE_SHORTCUT);
      expect((await controller.change({ shortcut: 'Control+Alt+G' })).error).toBeNull();
      expect(environment.calls.slice(-2)).toEqual([
        'register:Control+Alt+G',
        `unregister:${DEFAULT_SHOW_HIDE_SHORTCUT}`,
      ]);
    }
  );

  it('releases only its binding during capture, serializes cancellation, and never persists capture', async () => {
    const environment = setup();
    const controller = environment.create();
    await controller.initialize();
    await controller.change({ shortcut: 'Control+Alt+G' });
    const before = await readFile(environment.file, 'utf8');
    environment.registered.add('Control+X');
    const paused = controller.setShortcutCapture(true);
    const rejected = controller.change({ shortcut: 'Control+R' });
    const restored = controller.setShortcutCapture(false);
    expect((await paused).preferences.activeShortcut).toBeNull();
    expect((await rejected).error).toContain('cancel');
    expect((await restored).preferences.activeShortcut).toBe('Control+Alt+G');
    expect([...environment.registered].sort()).toEqual(['Control+Alt+G', 'Control+X']);
    expect(await readFile(environment.file, 'utf8')).toBe(before);
    const calls = environment.calls.length;
    await controller.setShortcutCapture(false);
    expect(environment.calls).toHaveLength(calls);
    expect((await controller.setShortcutCapture('true')).error).toContain('Invalid');
    expect(controller.getState().activeShortcut).toBe('Control+Alt+G');
    environment.registered.delete('Control+Alt+G');
    const restarted = environment.create();
    await restarted.initialize();
    expect(restarted.getState().activeShortcut).toBe('Control+Alt+G');
  });

  it('reports lost ownership truthfully when another app takes the binding during capture', async () => {
    const environment = setup();
    const controller = environment.create();
    await controller.initialize();
    await controller.setShortcutCapture(true);
    environment.occupied.add(DEFAULT_SHOW_HIDE_SHORTCUT);
    const restored = await controller.setShortcutCapture(false);
    expect(restored.error).toContain('could not be restored');
    expect(restored.preferences.activeShortcut).toBeNull();
    expect(restored.preferences.shortcut).toBe(DEFAULT_SHOW_HIDE_SHORTCUT);
    expect(environment.registered.size).toBe(0);
    const replacement = await controller.change({ shortcut: 'Control+R' });
    expect(replacement.error).toBeNull();
    expect(replacement.preferences.activeShortcut).toBe('Control+R');
  });

  it('does not acquire a binding it never owned when recording is cancelled', async () => {
    const environment = setup();
    environment.occupied.add(DEFAULT_SHOW_HIDE_SHORTCUT);
    const controller = environment.create();
    await controller.initialize();
    environment.occupied.clear();
    await controller.setShortcutCapture(true);
    await controller.setShortcutCapture(false);
    expect(controller.getState().activeShortcut).toBeNull();
    expect(environment.registered.size).toBe(0);
  });

  it('rejects empty, malformed, and unsafe IPC requests without changing registration', async () => {
    const environment = setup();
    const controller = environment.create();
    await controller.initialize();
    for (const input of [
      { shortcut: '' },
      { shortcut: 'Shift+G' },
      { shortcut: 'Control++G' },
      { shortcut: 'Control+G', launchAtLogin: true },
      { launchAtLogin: 'yes' },
      { path: '/tmp' },
    ]) {
      expect((await controller.change(input)).error).not.toBeNull();
    }
    expect(environment.calls).toEqual([`register:${DEFAULT_SHOW_HIDE_SHORTCUT}`]);
    expect(normalizeShortcut('Option+Shift+F12')).toBe('Alt+Shift+F12');
  });

  it('reports a startup conflict and permits selecting a new working shortcut', async () => {
    const environment = setup();
    await writeFile(
      environment.file,
      JSON.stringify({ shortcut: 'Control+R', launchAtLogin: true })
    );
    environment.occupied.add('Control+R');
    const controller = environment.create();
    await controller.initialize();
    expect(controller.getState()).toMatchObject({
      shortcut: 'Control+R',
      activeShortcut: null,
      launchAtLogin: false,
    });
    expect(controller.getState().shortcutError).toContain('occupied');
    expect(environment.calls).not.toContain('login:true');
    expect((await controller.change({ shortcut: 'Control+T' })).preferences.activeShortcut).toBe(
      'Control+T'
    );
  });

  it('honors OS readback and never registers a development login executable', async () => {
    const environment = setup();
    environment.denyLogin();
    const controller = environment.create();
    await controller.initialize();
    const denied = await controller.change({ launchAtLogin: true });
    expect(denied.error).toContain('System Settings');
    expect(denied.preferences.launchAtLogin).toBe(false);
    const development = setup(false);
    const devController = development.create();
    await devController.initialize();
    expect((await devController.change({ launchAtLogin: true })).error).toContain('development');
    expect(development.calls).not.toContain('login:true');
  });

  it('rolls back a registered candidate if persistence fails, preserving prior shortcut', async () => {
    const environment = setup();
    const fs = createNodeFileSystem();
    const registered = new Set<string>();
    const controller = new PreferencesController(
      {
        ...fs,
        rename: () => Promise.reject(new Error('Disk is read-only')),
      },
      environment.file,
      {
        register: (shortcut) => {
          registered.add(shortcut);
          return true;
        },
        unregister: (shortcut) => {
          registered.delete(shortcut);
        },
        loginSupported: false,
        isMac: true,
        getLogin: () => false,
        setLogin: () => {
          throw new Error('unsupported');
        },
      }
    );
    await controller.initialize();
    expect((await controller.change({ shortcut: 'Control+T' })).error).toBe('Disk is read-only');
    expect([...registered]).toEqual([DEFAULT_SHOW_HIDE_SHORTCUT]);
  });

  it('refreshes external OS changes while running without silently re-enabling login', async () => {
    const environment = setup();
    const controller = environment.create();
    await controller.initialize();
    await controller.change({ launchAtLogin: true });
    environment.externalLogin(false);
    const refreshed = await controller.refresh();
    expect(refreshed.launchAtLogin).toBe(false);
    expect(refreshed.launchAtLoginError).toBeNull();
    expect(environment.calls.filter((call) => call.startsWith('login:'))).toEqual(['login:true']);
    expect(JSON.parse(await readFile(environment.file, 'utf8'))).toEqual({
      shortcut: DEFAULT_SHOW_HIDE_SHORTCUT,
      launchAtLogin: false,
    });
    environment.registered.clear();
    const restarted = environment.create();
    await restarted.initialize();
    expect(restarted.getState().launchAtLogin).toBe(false);
    expect(environment.calls.filter((call) => call.startsWith('login:'))).toEqual(['login:true']);
  });

  it('surfaces unknown OS readback state and recovers on reopening Settings', async () => {
    const environment = setup();
    const controller = environment.create();
    await controller.initialize();
    await controller.change({ launchAtLogin: true });
    environment.failReadback(true);
    const unknown = await controller.refresh();
    expect(unknown.launchAtLogin).toBeNull();
    expect(unknown.launchAtLoginError).toContain('Reopen Settings');
    expect(JSON.parse(await readFile(environment.file, 'utf8'))).toEqual({
      shortcut: DEFAULT_SHOW_HIDE_SHORTCUT,
      launchAtLogin: true,
    });
    expect((await controller.change({ launchAtLogin: false })).error).toContain(
      'could not be read'
    );
    expect(environment.calls.filter((call) => call.startsWith('login:'))).toEqual(['login:true']);
    environment.externalLogin(false);
    environment.failReadback(false);
    expect(await controller.refresh()).toMatchObject({
      launchAtLogin: false,
      launchAtLoginError: null,
    });
  });

  it('serializes concurrent changes so the final saved preferences contain both updates', async () => {
    const environment = setup();
    const controller = environment.create();
    await controller.initialize();
    const results = await Promise.all([
      controller.change({ shortcut: 'Control+R' }),
      controller.change({ launchAtLogin: true }),
    ]);
    expect(results.map((result) => result.error)).toEqual([null, null]);
    expect(JSON.parse(await readFile(environment.file, 'utf8'))).toEqual({
      shortcut: 'Control+R',
      launchAtLogin: true,
    });
  });
});
