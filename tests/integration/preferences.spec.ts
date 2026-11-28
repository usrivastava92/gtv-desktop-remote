import { readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from './app-harness';

for (const cancel of ['Escape', 'Tab', 'blur'] as const) {
  test(`PREF-CANCEL-${cancel}: capture releases real shortcut ownership`, async ({
    harness: h,
  }) => {
    const before = await h.api('getPreferences');
    await h.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await h.focusNativeWindow();
    await h.page.locator('#global-shortcut').click();
    await expect.poll(async () => (await h.api('getPreferences')).activeShortcut).toBeNull();
    if (cancel === 'blur') await h.page.locator('#settings-heading').focus();
    else await h.page.keyboard.press(cancel);
    await expect
      .poll(async () => (await h.api('getPreferences')).activeShortcut)
      .toBe(before.activeShortcut);
    expect((await h.api('getPreferences')).shortcut).toBe(before.shortcut);
    await expect(h.page.locator('#global-shortcut')).toHaveAttribute('aria-pressed', 'false');
    if (cancel === 'Tab') {
      await expect(
        h.page.getByRole('button', { name: 'Save shortcut', exact: true })
      ).toBeFocused();
      await h.page.keyboard.press('Shift+Tab');
      await expect(h.page.locator('#global-shortcut')).toBeFocused();
      await expect(h.page.locator('#global-shortcut')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => (await h.api('getPreferences')).activeShortcut).toBeNull();
      await h.page.keyboard.press('Escape');
      await expect
        .poll(async () => (await h.api('getPreferences')).activeShortcut)
        .toBe(before.activeShortcut);
    }
  });
}

test('PREF-RECORD: chord key release, shifted digit, save and process persistence', async ({
  harness: h,
}) => {
  await h.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await h.focusNativeWindow();
  await h.page.locator('#global-shortcut').click();
  await expect.poll(async () => (await h.api('getPreferences')).activeShortcut).toBeNull();
  await h.page.keyboard.down('Control');
  await h.page.keyboard.down('Shift');
  await h.page.keyboard.down('Digit1');
  await expect(h.page.getByRole('button', { name: 'Save shortcut', exact: true })).toBeDisabled();
  await h.page.keyboard.up('Digit1');
  await h.page.keyboard.up('Shift');
  await h.page.keyboard.up('Control');
  await expect(h.page.getByRole('button', { name: 'Save shortcut', exact: true })).toBeEnabled();
  await h.page.getByRole('button', { name: 'Save shortcut', exact: true }).click();
  await expect.poll(async () => (await h.api('getPreferences')).shortcut).toBe('Control+Shift+1');
  await h.restart();
  expect((await h.api('getPreferences')).shortcut).toBe('Control+Shift+1');
});

test('PREF-CONFLICT: actual Electron registration conflict rolls back previous ownership', async ({
  harness: h,
}) => {
  const before = await h.api('getPreferences');
  expect(
    await h.app.evaluate(({ globalShortcut }) =>
      globalShortcut.register('Control+Alt+F10', () => undefined)
    )
  ).toBe(true);
  const result = await h.api('changePreference', { shortcut: 'Control+Alt+F10' });
  expect(result.error).not.toBeNull();
  expect(result.preferences.shortcut).toBe(before.shortcut);
  expect(result.preferences.activeShortcut).toBe(before.activeShortcut);
  expect(
    await h.app.evaluate(
      ({ globalShortcut }, shortcut) => globalShortcut.isRegistered(shortcut),
      before.activeShortcut!
    )
  ).toBe(true);
  await h.app.evaluate(({ globalShortcut }) => globalShortcut.unregister('Control+Alt+F10'));
});

for (const login of [true, false, null] as const) {
  test(`PREF-LOGIN-${String(login)}: OS precedence and unknown UI state`, async ({
    harness: h,
  }) => {
    await h.system({ login });
    await h.page.getByRole('button', { name: 'Settings', exact: true }).click();
    const checkbox = h.page.getByRole('checkbox', { name: 'Launch at login' });
    expect((await h.api('getPreferences')).launchAtLogin).toBe(login);
    if (login === null) await expect(checkbox).toBeDisabled();
    else {
      if (login) await expect(checkbox).toBeChecked();
      else await expect(checkbox).not.toBeChecked();
      await checkbox.click();
      await expect.poll(async () => (await h.api('getPreferences')).launchAtLogin).toBe(!login);
      const state = JSON.parse(await readFile(path.join(h.profile, 'system.json'), 'utf8'));
      expect(state.login).toBe(!login);
    }
  });
}

test('PREF-LOGIN-ERROR: native get/set failures do not manufacture saved success', async ({
  harness: h,
}) => {
  await h.system({ loginGetError: 'Synthetic unreadable native login state' });
  const unreadable = await h.api('getPreferences');
  expect(unreadable.launchAtLogin).toBeNull();
  expect(unreadable.launchAtLoginError).not.toBeNull();
  await h.system({ loginGetError: undefined, loginSetError: 'Synthetic native login refusal' });
  const failed = await h.api('changePreference', { launchAtLogin: true });
  expect(failed.error).not.toBeNull();
  expect(failed.preferences.launchAtLogin).toBe(false);
});

test('PREF-CRASH: renderer process crash restores actual registered shortcut', async ({
  harness: h,
}) => {
  const before = await h.api('getPreferences');
  await h.focusNativeWindow();
  await h.api('setShortcutCapture', true);
  expect(
    await h.app.evaluate(
      ({ globalShortcut }, shortcut) => globalShortcut.isRegistered(shortcut),
      before.activeShortcut!
    )
  ).toBe(false);
  await h.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()
  );
  await expect
    .poll(() =>
      h.app.evaluate(
        ({ globalShortcut }, shortcut) => globalShortcut.isRegistered(shortcut),
        before.activeShortcut!
      )
    )
    .toBe(true);
});

test('WINDOW-LIFECYCLE: native close destroys the window and tray show recreates the built renderer with persisted state', async ({
  harness: h,
}) => {
  await h.pair();
  const saved = (await h.api('bootstrap')).devices;
  const preferences = await h.api('getPreferences');
  const processId = h.app.process().pid;
  const context = h.page.context();
  const windowId = await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  await h.trayAction('hide-remote');
  await expect
    .poll(() => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(false);
  await h.trayAction('show-remote');
  await expect
    .poll(() => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true);

  const closed = h.page.waitForEvent('close');
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  expect(await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
  expect(h.app.process().exitCode).toBeNull();
  expect(
    await h.app.evaluate(
      ({ globalShortcut }, shortcut) => globalShortcut.isRegistered(shortcut),
      preferences.activeShortcut!
    )
  ).toBe(true);

  const recreated = h.app.waitForEvent('window');
  await h.trayAction('show-remote');
  h.page = await recreated;
  expect(h.page.context()).toBe(context);
  await expect(h.page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  expect(new URL(h.page.url()).protocol).toBe('file:');
  expect(await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id)).not.toBe(
    windowId
  );
  expect(h.app.process().pid).toBe(processId);
  expect(await h.api('getPreferences')).toEqual(preferences);
  expect((await h.api('bootstrap')).devices).toEqual(saved);
  expect(JSON.parse(await readFile(path.join(h.profile, 'devices.json'), 'utf8')).devices).toEqual(
    saved
  );
  await expect(h.page.getByRole('button', { name: 'Select', exact: true })).toBeEnabled();
  await h.page.locator('.ui-dpad-right').click();
  await h.tv.waitFor((state) => state.cursor.x === 3);
});

test('PREF-DEFAULT-ALIASES-LABELS: default chord, equivalent aliases and native-platform visible labels', async ({
  harness: h,
}) => {
  const initial = await h.api('getPreferences');
  expect(initial.shortcut).toBe('CommandOrControl+Shift+G');
  expect(initial.activeShortcut).toBe(initial.shortcut);
  const equivalent = await h.api('changePreference', { shortcut: 'cmdorctrl+shift+g' });
  expect(equivalent.error).toBeNull();
  expect(equivalent.preferences.activeShortcut).toBe(initial.activeShortcut);
  const platform = await h.app.evaluate(() => process.platform);
  await h.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(h.page.locator('#global-shortcut')).toHaveText(
    `${platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Shift+G`
  );
  await h.page.getByRole('button', { name: 'Done', exact: true }).click();
  const alias = await h.api('changePreference', { shortcut: 'ctrl+option+F9' });
  expect(alias.error).toBeNull();
  expect(alias.preferences.shortcut).toBe('Control+Alt+F9');
  await h.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(h.page.locator('#global-shortcut')).toHaveText(
    `Ctrl+${platform === 'darwin' ? 'Opt' : 'Alt'}+F9`
  );
});

test('PREF-DISK-ROLLBACK: actual persistence failure releases replacement and preserves owned shortcut', async ({
  harness: h,
}) => {
  const before = await h.api('getPreferences');
  const file = path.join(h.profile, 'preferences.json');
  await rm(file, { force: true });
  await mkdir(file);
  const result = await h.api('changePreference', { shortcut: 'Control+Alt+F11' });
  expect(result.error).not.toBeNull();
  expect(result.preferences.activeShortcut).toBe(before.activeShortcut);
  expect(
    await h.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+F11'))
  ).toBe(false);
  expect(
    await h.app.evaluate(
      ({ globalShortcut }, shortcut) => globalShortcut.isRegistered(shortcut),
      before.activeShortcut!
    )
  ).toBe(true);
});
