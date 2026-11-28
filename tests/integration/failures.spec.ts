import { readdir, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from './app-harness';
import { createTvEmulator } from './emulator/tv-emulator';

test('PAIR-FAILURE-pairing-reject: received secret is rejected, leaves unauthorized state and UI retry succeeds', async ({
  harness: h,
}) => {
  await h.preparePairing();
  await h.tv.setFault('pairing-reject');
  await h.openPairing();
  expect(h.tv.snapshot().pairedClients).toBe(0);
  const traceStart = h.tv.traces.length;
  await h.page.locator('input[autocomplete="one-time-code"]').fill(h.tv.pairingCode);
  await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(async () => (await h.api('bootstrap')).deviceState.status).toBe('error');
  expect(
    h.tv.traces
      .slice(traceStart)
      .some(
        (trace) =>
          trace.service === 'pairing' &&
          trace.direction === 'rx' &&
          trace.message.includes('pairingSecret')
      )
  ).toBe(true);
  expect(h.tv.snapshot().pairedClients).toBe(0);
  expect((await h.api('bootstrap')).devices[0].isPaired).not.toBe(true);
  await expect(
    h.page.getByRole('heading', { name: 'New Devices Found', exact: true })
  ).toBeVisible();
  await expect(h.page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
  await h.tv.setFault('none');
  await h.openPairing();
  await h.page.locator('input[autocomplete="one-time-code"]').fill(h.tv.pairingCode);
  await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await h.tv.waitFor((state) => state.ready && state.pairedClients === 1);
  await expect(h.page.getByRole('button', { name: 'Select', exact: true })).toBeEnabled();
});

test('PAIR-FAILURE-pairing-silence: missing handshake reply fails before secret, then explicit retry succeeds', async ({
  harness: h,
}) => {
  const device = await h.preparePairing();
  await h.tv.setFault('pairing-silence');
  const traceStart = h.tv.traces.length;
  await expect(h.api('startPairing', device.id)).rejects.toThrow();
  expect((await h.api('bootstrap')).deviceState.status).toBe('error');
  expect(h.tv.snapshot().pairedClients).toBe(0);
  expect(
    h.tv.traces
      .slice(traceStart)
      .some(
        (trace) =>
          trace.service === 'pairing' &&
          trace.direction === 'rx' &&
          trace.message.includes('pairingRequest')
      )
  ).toBe(true);
  expect(
    h.tv.traces
      .slice(traceStart)
      .some(
        (trace) =>
          trace.service === 'pairing' &&
          trace.direction === 'rx' &&
          trace.message.includes('pairingSecret')
      )
  ).toBe(false);
  await h.tv.setFault('none');
  await h.openPairing();
  await h.page.locator('input[autocomplete="one-time-code"]').fill(h.tv.pairingCode);
  await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await h.tv.waitFor((state) => state.ready && state.pairedClients === 1);
  await expect(h.page.getByRole('button', { name: 'Select', exact: true })).toBeEnabled();
});

test('PAIR-INVALID: nonhex, bad checksum and missing pairing session reject without pairing', async ({
  harness: h,
}) => {
  const saved = await h.api('saveDevice', {
    name: 'Validation TV',
    host: h.tv.host,
    adbPort: 5555,
  });
  const before = await h.api('bootstrap');
  const traceStart = h.tv.traces.length;
  await expect(
    h.api('pair', { deviceId: saved[0].id, host: h.tv.host, code: 'ABCDEF' })
  ).rejects.toThrow('Start pairing and request a new code');
  // An out-of-session request is a rejected operation, not a failed transport session.
  expect((await h.api('bootstrap')).deviceState).toEqual(before.deviceState);
  expect(h.tv.traces.slice(traceStart).some((trace) => trace.service === 'pairing')).toBe(false);
  expect((await h.api('bootstrap')).devices[0].isPaired).not.toBe(true);
  expect(h.tv.snapshot().pairedClients).toBe(0);

  // As in preparePairing, the fixture starts offline until the real app creates its certificate.
  await expect(h.api('startPairing', saved[0].id)).rejects.toThrow();
  expect((await h.api('bootstrap')).deviceState.status).toBe('error');
  await h.tv.trustClient(await h.certificate());
  await h.tv.start();

  for (const invalidCode of ['OO1234', '12345', '1234567', 'bad-checksum']) {
    await h.api('startPairing', saved[0].id);
    const code =
      invalidCode === 'bad-checksum'
        ? `${h.tv.pairingCode[0] === '0' ? '1' : '0'}${h.tv.pairingCode.slice(1)}`
        : invalidCode;
    const submissionStart = h.tv.traces.length;
    await expect(h.api('pair', { deviceId: saved[0].id, host: h.tv.host, code })).rejects.toThrow();
    const failed = await h.api('bootstrap');
    expect(failed.deviceState.status).toBe('error');
    expect(failed.deviceState.message).toBeTruthy();
    expect(failed.deviceState.pairing).toBeUndefined();
    expect(failed.devices[0].isPaired).not.toBe(true);
    expect(h.tv.snapshot().pairedClients).toBe(0);
    expect(
      h.tv.traces
        .slice(submissionStart)
        .some((trace) => trace.direction === 'rx' && trace.message.includes('pairingSecret'))
    ).toBe(false);
  }

  await h.api('startPairing', saved[0].id);
  await h.api('pair', { deviceId: saved[0].id, host: h.tv.host, code: h.tv.pairingCode });
  expect((await h.api('bootstrap')).devices[0].isPaired).toBe(true);
  expect((await h.api('bootstrap')).deviceState.message).toContain('Pairing succeeded');
  expect((await h.api('connect', saved[0].id)).status).toBe('connected');
  await h.tv.waitFor((state) => state.ready && state.pairedClients === 1);
});

for (const fault of [
  'fragment',
  'coalesce',
  'invalid-frame',
  'truncated-frame',
  'remote-reject',
] as const) {
  test(`WIRE-${fault}: real framed transport behavior and recovery`, async ({ harness: h }) => {
    const device = await h.pair();
    await h.api('disconnect');
    await h.tv.waitFor((s) => !s.connected);
    await h.tv.setFault(fault);
    if (fault === 'fragment' || fault === 'coalesce') {
      expect((await h.api('connect', device.id)).status).toBe('connected');
      // Connection readiness precedes IME metadata; finish ordered fixture delivery first.
      const pingReplies = h.tv.snapshot().pingReplies;
      h.tv.sendPing();
      await h.tv.waitFor((s) => s.pingReplies === pingReplies + 1);
      await h.api('sendText', 'wire 世界');
      await h.tv.waitFor((s) => s.text === 'wire 世界');
    } else {
      await expect(h.api('connect', device.id)).rejects.toThrow();
      expect((await h.api('bootstrap')).deviceState.status).toBe('error');
    }
    await h.tv.setFault('none');
    expect((await h.api('connect', device.id)).status).toBe('connected');
  });
}

for (const microphone of ['denied', 'granted'] as const) {
  test(`VOICE-CLEANUP-${microphone}: permission or transport failure releases capture and supports retry`, async ({
    harness: h,
  }) => {
    await h.pair();
    await h.system({ microphone });
    if (microphone === 'granted') await h.tv.setFault('voice-silence');
    await h.page.locator('.ui-media-subgrid button').first().click();
    await expect(h.page.locator('.ui-alert')).toBeVisible();
    await expect.poll(() => h.api('hasPendingAssistantVoiceSession')).toBe(false);
    await expect(h.page.getByLabel('Assistant listening')).toHaveCount(0);
    await h.tv.setFault('none');
    await h.system({ microphone: 'granted' });
    await h.reconnectFromDevicePicker();
    await h.page.locator('.ui-media-subgrid button').first().click();
    await h.tv.waitFor((s) => s.voice.samples > 0);
    await h.page.locator('.ui-media-subgrid button').first().click();
    await h.tv.waitFor((s) => s.voice.phase === 'ended');
  });
}

test('RESET: cancel preserves identity, confirm deletes saved and legacy credentials', async ({
  harness: h,
}) => {
  await h.pair();
  const devices = (await h.api('bootstrap')).devices;
  expect(devices).toHaveLength(1);
  const certificate = await h.certificate();
  const reset = h.page.getByRole('button', { name: 'Clear app state', exact: true });
  await h.page.getByRole('button', { name: 'Devices', exact: true }).click();
  await h.page.getByRole('button', { name: 'Settings', exact: true }).click();
  // Fixture only the OS confirmation decision; clicks, reset IPC and storage stay real.
  // CDP dismissal does not reliably restore Electron's native window focus.
  await h.page.evaluate(() => {
    window.confirm = () => false;
  });
  await reset.click();
  expect((await h.api('bootstrap')).devices).toEqual(devices);
  expect(await h.certificate()).toBe(certificate);
  const legacy = path.join(h.profile, 'legacy', 'GTV Desktop Remote');
  await mkdir(path.join(legacy, 'androidtvremote'), { recursive: true });
  await writeFile(path.join(legacy, 'devices.json'), '[]');
  await writeFile(path.join(legacy, 'androidtvremote', 'old.key.pem'), 'SYNTHETIC OLD CREDENTIAL');
  await h.page.evaluate(() => {
    window.confirm = () => true;
  });
  await reset.click();
  // Await reset completion in Settings, then verify the cleared picker.
  await expect(reset).toBeEnabled();
  await h.page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(h.page.locator('.ui-devices-content .ui-card')).toHaveCount(0);
  expect((await h.api('bootstrap')).devices).toEqual([]);
  const certificateFiles = await readdir(path.join(h.profile, 'androidtvremote')).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    }
  );
  expect(certificateFiles.some((name) => name.endsWith('.pem'))).toBe(false);
  await expect(access(path.join(legacy, 'androidtvremote'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(access(path.join(legacy, 'devices.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('METRICS-BURST: actual renderer input saturates queue and records drops with terminal lifecycle', async ({
  harness: h,
}) => {
  await h.pair();
  await h.page.evaluate(() => {
    for (let i = 0; i < 250; i++)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  await expect
    .poll(async () => (await h.api('getMetricsSnapshot')).counters.rendererDrops)
    .toBeGreaterThan(0);
  expect(
    (await h.api('getMetricsSnapshot')).recentCommands.some(
      (c) => c.dropReason === 'renderer_burst_limit'
    )
  ).toBe(true);
  await expect
    .poll(async () => {
      const { counters } = await h.api('getMetricsSnapshot');
      return counters.totalSucceeded + counters.totalDropped + counters.totalFailed;
    })
    .toBe(250);
  const metrics = await h.api('getMetricsSnapshot');
  expect(metrics.counters.totalSubmitted).toBe(250);
  expect(metrics.counters.rendererDrops).toBe(metrics.counters.totalDropped);
  expect(metrics.counters.totalFailed).toBe(0);
  expect(metrics.recentCommands.length).toBeLessThanOrEqual(40);
  expect(metrics.recentCommands.every((c) => c.status !== 'pending')).toBe(true);
  await h.tv.waitFor(
    (s) =>
      s.keyEvents.filter((event) => event.code === 22 && event.direction !== 2).length ===
      metrics.counters.totalSucceeded
  );
  expect(h.tv.snapshot().cursor.x).toBe(4);
});

test('METRICS-FAILURE: no active device produces a terminal public command failure with cause', async ({
  harness: h,
}) => {
  const issuedAt = Date.now();
  await expect(
    h.api('sendCommand', { id: 'no-active-device', command: 'right', source: 'button', issuedAt })
  ).rejects.toThrow();
  const snapshot = await h.api('getMetricsSnapshot');
  const record = snapshot.recentCommands.find((command) => command.id === 'no-active-device');
  expect(record?.status).toBe('failed');
  expect(record?.dropReason).toBe('no_active_device');
  expect(record?.ipcReceivedAt).toBeGreaterThanOrEqual(issuedAt);
  expect(snapshot.counters.totalFailed).toBe(1);
  expect(snapshot.transport.socketState).toBe('disconnected');
  expect(h.tv.snapshot().keyEvents).toHaveLength(0);
});

test('METRICS-TRANSPORT-FAULT: actual command reconnect refusal records connect failure and later send succeeds', async ({
  harness: h,
}) => {
  await h.pair();
  await h.tv.setFault('refuse');
  await h.tv.waitFor((state) => !state.connected);
  await expect(
    h.api('sendCommand', {
      id: 'refused-command',
      command: 'right',
      source: 'button',
      issuedAt: Date.now(),
    })
  ).rejects.toThrow();
  const failed = await h.api('getMetricsSnapshot');
  expect(failed.counters.connectFailures).toBeGreaterThan(0);
  expect(failed.recentCommands.find((command) => command.id === 'refused-command')?.status).toBe(
    'failed'
  );
  // A second fixture must not claim the endpoint while the first has no listeners.
  const concurrentTv = await createTvEmulator();
  try {
    concurrentTv.trustClient(await h.certificate());
    await concurrentTv.start();
    await h.tv.setFault('none');
    await h.api('sendCommand', {
      id: 'transport-recovered-command',
      command: 'right',
      source: 'button',
      issuedAt: Date.now(),
    });
    await h.tv.waitFor((state) => state.cursor.x === 3);
    const recovered = await h.api('getMetricsSnapshot');
    expect(
      recovered.recentCommands.find((command) => command.id === 'transport-recovered-command')
        ?.status
    ).toBe('sent');
    expect(recovered.transport.consecutiveSendFailures).toBe(0);
    expect(concurrentTv.snapshot().cursor).toEqual({ x: 2, y: 2 });
    expect(concurrentTv.snapshot().keyEvents).toEqual([]);
    expect(concurrentTv.snapshot().remoteConnections).toBe(0);
  } finally {
    await concurrentTv.stop();
  }
});
