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

  function setup(loginSupported = true) {
    const occupied = new Set<string>();
    const registered = new Set<string>();
    const calls: string[] = [];
    let login = false;
    let denyLogin = false;
    let failReadback = false;
    const file = path.join(directory, 'preferences.json');
    const platform = {
      loginSupported,
      register: (shortcut: string) => {
        calls.push(`register:${shortcut}`);
        if (occupied.has(shortcut) || registered.has(shortcut)) return false;
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
