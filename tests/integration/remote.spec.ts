import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from './app-harness';

for (const control of ['body', 'plus'] as const) {
  test(`PAIR-${control}: refused bootstrap, explicit certificate trust, hexadecimal pairing and remote readiness`, async ({
    harness: h,
  }) => {
    await h.pair(control);
    expect(h.tv.snapshot().pairedClients).toBe(1);
    expect((await h.api('bootstrap')).deviceState.status).toBe('connected');
  });
}

test('REMOTE-CAPABILITIES: Google rejects Home hold without sending keys or breaking Home', async ({
  harness: h,
}) => {
  await h.pair();
  const capabilities = await h.api('capabilities');
  expect(capabilities.supportedCommands).not.toContain('home_hold');
  const before = h.tv.snapshot().keyEvents.length;
  await expect(
    h.api('sendCommand', {
      id: 'unsupported-home-hold',
      command: 'home_hold',
      source: 'button',
      issuedAt: Date.now(),
    })
  ).rejects.toThrow('not supported');
  expect(h.tv.snapshot().keyEvents).toHaveLength(before);
  await h.api('sendCommand', {
    id: 'supported-home',
    command: 'home',
    source: 'button',
    issuedAt: Date.now(),
  });
  await h.tv.waitFor((state) => state.keyEvents.length === before + 2 && state.screen === 'home');
});

test('REMOTE-MOUSE: every remote control changes independent TV model', async ({ harness: h }) => {
  await h.pair();
  for (const [selector, x, y] of [
    ['.ui-dpad-up', 2, 1],
    ['.ui-dpad-down', 2, 2],
    ['.ui-dpad-left', 1, 2],
    ['.ui-dpad-right', 2, 2],
  ] as const) {
    await h.page.locator(selector).click();
    await h.tv.waitFor((s) => s.cursor.x === x && s.cursor.y === y);
  }
  await h.page.getByRole('button', { name: 'Select', exact: true }).click();
  await h.tv.waitFor((s) => s.selected === 1);
  await h.page.getByRole('button', { name: 'Home', exact: true }).click();
  await h.tv.waitFor((s) => s.screen === 'home');
  await h.page.getByRole('button', { name: 'Back', exact: true }).click();
  await h.page.locator('.ui-media-button-block').first().click();
  await h.tv.waitFor((s) => s.volume === 21);
  await h.page.locator('.ui-media-button-block').last().click();
  await h.tv.waitFor((s) => s.volume === 20);
  await h.page.locator('.ui-media-primary').click();
  await h.tv.waitFor((s) => s.playing);
  await h.page.locator('.ui-media-danger').click();
  await h.tv.waitFor((s) => !s.powered);
  await expect
    .poll(async () => (await h.api('getMetricsSnapshot')).counters.totalSucceeded)
    .toBe(11);
  const metrics = await h.api('getMetricsSnapshot');
  expect(metrics.counters.totalSucceeded).toBeGreaterThanOrEqual(11);
  expect(
    metrics.recentCommands.every((c) => c.status === 'sent' && c.completedAt !== undefined)
  ).toBe(true);
});

test('REMOTE-KEYBOARD: directions, select, navigation, media and power aliases', async ({
  harness: h,
}) => {
  await h.pair();
  const start = h.tv.snapshot().keyEvents.length;
  for (const key of [
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Enter',
    'h',
    'Escape',
    'Space',
    '+',
    '-',
    'p',
  ])
    await h.page.keyboard.press(key);
  await h.tv.waitFor((s) => s.keyEvents.length >= start + 22);
  await expect
    .poll(async () => (await h.api('getMetricsSnapshot')).counters.totalSucceeded)
    .toBe(11);
  const metrics = await h.api('getMetricsSnapshot');
  expect(metrics.recentCommands.map((c) => c.command).sort()).toEqual(
    [
      'up',
      'down',
      'left',
      'right',
      'select',
      'home',
      'back',
      'play_pause',
      'volume_up',
      'volume_down',
      'power',
    ].sort()
  );
  expect(metrics.recentCommands.every((c) => c.source === 'keyboard')).toBe(true);
});

test('TEXT-UNICODE: empty guard, IME counters, repeated Unicode text and close', async ({
  harness: h,
}) => {
  await h.pair();
  await h.page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(h.page.getByRole('button', { name: 'Send Text', exact: true })).toBeDisabled();
  await h.page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(h.page.getByPlaceholder('Type text to send to the TV')).toHaveCount(0);
  for (const text of ['Hello 世界 🎬', 'नमस्ते café']) {
    const before = h.tv.snapshot().imeCounter;
    await h.page.getByRole('button', { name: 'Text', exact: true }).click();
    await h.page.getByPlaceholder('Type text to send to the TV').fill(text);
    await h.page.getByRole('button', { name: 'Send Text', exact: true }).click();
    await h.tv.waitFor((s) => s.text === text && s.imeCounter > before);
    await expect(h.page.getByPlaceholder('Type text to send to the TV')).toHaveCount(0);
  }
  await h.page.getByRole('button', { name: 'Text', exact: true }).click();
  await h.page.getByPlaceholder('Type text to send to the TV').fill('   ');
  await expect(h.page.getByRole('button', { name: 'Send Text', exact: true })).toBeDisabled();
  await h.page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(h.page.getByPlaceholder('Type text to send to the TV')).toHaveCount(0);
});

test('VOICE-WAVEFORM: Chromium fake microphone traverses production PCM and TLS', async ({
  harness: h,
}) => {
  await h.pair();
  const assistant = h.page.locator('.ui-media-subgrid button').first();
  await assistant.click();
  await expect(h.page.getByLabel('Assistant listening')).toBeVisible();
  await h.tv.waitFor((s) => s.voice.samples >= 8000);
  await assistant.click();
  const state = await h.tv.waitFor((s) => s.voice.phase === 'ended');
  expect(state.voice.valid).toBe(true);
  expect(state.voice.frequencyHz).toBeGreaterThan(420);
  expect(state.voice.frequencyHz).toBeLessThan(460);
  expect(state.voice.rms).toBeGreaterThan(0.12);
  expect(state.voice.rms).toBeLessThan(0.23);
  expect(await h.api('hasPendingAssistantVoiceSession')).toBe(false);
  await expect(h.page.getByLabel('Assistant listening')).toHaveCount(0);
});

test('DEVICE-PERSISTENCE: reconnect after actual process restart, forget and certificate cleanup', async ({
  harness: h,
}) => {
  const device = await h.pair();
  const cert = await h.certificate();
  await h.restart();
  expect((await h.api('bootstrap')).devices[0].id).toBe(device.id);
  expect(await h.certificate()).toBe(cert);
  await h.page.getByRole('button').filter({ hasText: 'Synthetic TV' }).first().click();
  await h.tv.waitFor((s) => s.ready);
  await h.page.getByRole('button', { name: 'Forget', exact: true }).click();
  await expect.poll(async () => (await h.api('bootstrap')).devices.length).toBe(0);
  await expect
    .poll(
      async () =>
        (await readdir(path.join(h.profile, 'androidtvremote')).catch(() => [])).filter((file) =>
          file.endsWith('.pem')
        ).length
    )
    .toBe(0);
  await h.tv.waitFor((state) => !state.connected);
});

test('REMOTE-RECOVERY: disconnect, failed transport, reconnect and lifecycle metrics', async ({
  harness: h,
}) => {
  const device = await h.pair();
  await h.tv.disconnectRemote();
  await h.tv.setFault('refuse');
  await h.api('disconnect');
  await expect(h.api('connect', device.id)).rejects.toThrow();
  expect((await h.api('bootstrap')).deviceState.status).toBe('error');
  await h.tv.setFault('none');
  expect((await h.api('connect', device.id)).status).toBe('connected');
  await h.tv.waitFor((s) => s.ready);
  await h.api('sendCommand', {
    id: 'recovered-command',
    command: 'right',
    source: 'button',
    issuedAt: Date.now(),
  });
  await h.tv.waitFor((s) => s.cursor.x === 3);
  expect((await h.api('getMetricsSnapshot')).transport.socketState).toBe('connected');
});

test('REMOTE-KEYBOARD-ALIASES: uppercase, backspace, media and shifted-volume aliases use production queue', async ({
  harness: h,
}) => {
  await h.pair();
  for (const key of ['H', 'Backspace', 'k', 'K', '=', '_', 'P']) await h.page.keyboard.press(key);
  await expect
    .poll(async () => (await h.api('getMetricsSnapshot')).counters.totalSucceeded)
    .toBe(7);
  const snapshot = await h.api('getMetricsSnapshot');
  expect(snapshot.recentCommands.map((command) => command.command).sort()).toEqual(
    ['home', 'back', 'play_pause', 'play_pause', 'volume_up', 'volume_down', 'power'].sort()
  );
  const state = await h.tv.waitFor((state) => state.keyEvents.length === 14);
  expect(state.playing).toBe(false);
  expect(state.volume).toBe(20);
  expect(state.powered).toBe(false);
});
