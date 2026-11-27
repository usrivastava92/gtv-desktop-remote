import { test, expect } from './app-harness';

for (const release of ['g', 'Enter', 'Escape'] as const) {
  test(`VOICE-KEYBOARD-${release}: hold captures real PCM and release/cancel cleans session`, async ({
    harness: h,
  }) => {
    await h.pair();
    await h.page.keyboard.down('g');
    await h.tv.waitFor((s) => s.voice.samples >= 4096);
    if (release !== 'g') await h.page.keyboard.press(release);
    await h.page.keyboard.up('g');
    await h.tv.waitFor((s) => s.voice.phase === 'ended');
    expect(await h.api('hasPendingAssistantVoiceSession')).toBe(false);
  });
}

test('VOICE-PENDING-EMPTY: production session pending, empty payload guard and explicit stop', async ({
  harness: h,
}) => {
  await h.pair();
  const id = await h.api('startAssistantVoice');
  expect(await h.api('hasPendingAssistantVoiceSession')).toBe(true);
  const before = h.tv.snapshot().voice.bytes;
  await h.api('sendAssistantVoiceChunk', id, '');
  expect(h.tv.snapshot().voice.bytes).toBe(before);
  await h.api('stopAssistantVoice', id);
  expect(await h.api('hasPendingAssistantVoiceSession')).toBe(false);
  await h.tv.waitFor((s) => s.voice.phase === 'ended');
  expect(h.tv.snapshot().voice.bytes).toBe(0);
});

test('VOICE-TRANSPORT: server loss during recording cleans capture and supports new session', async ({
  harness: h,
}) => {
  await h.pair();
  await h.page.keyboard.down('g');
  const started = await h.tv.waitFor((s) => s.voice.samples > 0);
  const oldSessionId = started.voice.sessionId;
  const oldConnections = started.remoteConnections;
  await h.tv.disconnectRemote();
  await h.tv.waitFor((state) => !state.connected);
  await h.page.keyboard.up('g');
  await expect(h.api('sendAssistantVoiceChunk', oldSessionId, 'AAAAAAAAAAA=')).rejects.toThrow();
  await h.api('stopAssistantVoice', oldSessionId);
  await expect.poll(() => h.api('hasPendingAssistantVoiceSession')).toBe(false);
  await expect(h.page.getByLabel('Assistant listening')).toHaveCount(0);
  await expect(h.page.locator('.ui-alert')).toBeVisible();
  expect(h.tv.snapshot().remoteConnections).toBe(oldConnections);
  expect(h.tv.snapshot().connected).toBe(false);
  await h.reconnectFromDevicePicker();
  expect(h.tv.snapshot().remoteConnections).toBe(oldConnections + 1);
  await h.page.keyboard.press('v');
  await h.tv.waitFor((s) => s.voice.sessionId > oldSessionId && s.voice.samples >= 8000);
  await h.page.keyboard.press('v');
  const completed = await h.tv.waitFor((s) => s.voice.phase === 'ended');
  expect(completed.voice.sessionId).toBeGreaterThan(oldSessionId);
  expect(completed.voice.valid).toBe(true);
  expect(completed.voice.frequencyHz).toBeGreaterThan(420);
  expect(completed.voice.frequencyHz).toBeLessThan(460);
  expect(await h.api('hasPendingAssistantVoiceSession')).toBe(false);
});

test('TEXT-TRANSPORT: real TLS failure rejects text and successful reconnection accepts Unicode', async ({
  harness: h,
}) => {
  const device = await h.pair();
  await h.api('disconnect');
  await h.tv.setFault('refuse');
  await expect(h.api('sendText', 'failed')).rejects.toThrow();
  await h.tv.setFault('none');
  expect((await h.api('connect', device.id)).status).toBe('connected');
  await h.page.getByRole('button', { name: 'Text', exact: true }).click();
  await h.page.getByPlaceholder('Type text to send to the TV').fill('recovered 世界');
  await h.page.getByRole('button', { name: 'Send Text', exact: true }).click();
  await h.tv.waitFor((s) => s.text === 'recovered 世界');
});

test('SERVER-METADATA-PING: incoming app and power information preserve ready command transport', async ({
  harness: h,
}) => {
  await h.pair();
  h.tv.setApp('com.synthetic.video');
  h.tv.setPower(false);
  h.tv.sendPing();
  await h.tv.waitFor((s) => s.pingReplies > 0);
  await h.page.locator('.ui-media-danger').click();
  await h.tv.waitFor((s) => s.powered);
  expect(h.tv.snapshot().app).toBe('com.synthetic.video');
  expect((await h.api('getMetricsSnapshot')).transport.lastInboundMessageAt).toBeGreaterThan(0);
});

test('WIRE-CAPABILITY-ABSENCE: server negotiation without IME does not corrupt remote session', async ({
  harness: h,
}) => {
  const device = await h.pair();
  await h.api('disconnect');
  await h.tv.waitFor((s) => !s.connected);
  h.tv.setCapabilities(3);
  const limitedTraceStart = h.tv.traces.length;
  expect((await h.api('connect', device.id)).status).toBe('connected');
  // Adapter advertises a static app capability; assert current user-visible contract rather than hiding the feature in a test.
  expect((await h.api('capabilities')).textInput).toBe(true);
  await h.api('sendCommand', {
    id: 'limited-capabilities',
    command: 'right',
    source: 'button',
    issuedAt: Date.now(),
  });
  await h.tv.waitFor((s) => s.cursor.x === 3);
  expect(
    h.tv.traces
      .slice(limitedTraceStart)
      .filter((entry) => entry.direction === 'tx' && entry.message === 'remoteImeBatchEdit')
  ).toHaveLength(0);
  await h.api('disconnect');
  await h.tv.waitFor((s) => !s.connected);
  h.tv.setCapabilities(623);
  expect((await h.api('connect', device.id)).status).toBe('connected');
  // connect() resolves on remoteStart, before the separately framed IME metadata is necessarily
  // received. A ping queued after that metadata proves the real client consumed the ordered stream.
  const pingReplies = h.tv.snapshot().pingReplies;
  h.tv.sendPing();
  await h.tv.waitFor((s) => s.pingReplies === pingReplies + 1);
  const beforeText = h.tv.snapshot();
  await h.api('sendText', 'IME restored 世界 🎬 é');
  const restored = await h.tv.waitFor((s) => s.text === 'IME restored 世界 🎬 é');
  expect(restored.imeCounter).toBe(beforeText.imeCounter + 1);
  expect(restored.fieldCounter).toBe(beforeText.fieldCounter);
  expect(restored.errors).toEqual([]);
});

test('VOICE-GETUSERMEDIA-DENIAL: actual Chromium native permission refusal tears down capture and retry succeeds', async ({
  harness: h,
}) => {
  await h.pair();
  await h.restart({ fakeMediaUi: false });
  await h.page.locator('.ui-card').filter({ hasText: 'Synthetic TV' }).click();
  await expect(h.page.getByRole('button', { name: 'Select', exact: true })).toBeEnabled();
  await h.app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis as typeof globalThis & { __gtvDeniedMediaPermissions?: string[] };
    fixture.__gtvDeniedMediaPermissions = [];
    const nativeSession = BrowserWindow.getAllWindows()[0].webContents.session;
    nativeSession.setPermissionCheckHandler((_contents, permission) => {
      fixture.__gtvDeniedMediaPermissions!.push(permission);
      return false;
    });
    nativeSession.setPermissionRequestHandler((_contents, permission, callback) => {
      fixture.__gtvDeniedMediaPermissions!.push(permission);
      callback(false);
    });
  });
  await h.page.locator('.ui-media-subgrid button').first().click();
  await expect
    .poll(() =>
      h.app.evaluate(
        () =>
          (globalThis as typeof globalThis & { __gtvDeniedMediaPermissions?: string[] })
            .__gtvDeniedMediaPermissions
      )
    )
    .toContain('media');
  await expect(h.page.locator('.ui-alert')).toBeVisible();
  await expect(h.page.locator('.ui-alert')).toContainText('Microphone access denied');
  expect(h.tv.snapshot().voice.sessionId).toBe(0);
  await expect(h.page.getByLabel('Assistant listening')).toHaveCount(0);
  expect(h.tv.snapshot().voice.bytes).toBe(0);
  expect(await h.api('hasPendingAssistantVoiceSession')).toBe(false);
  await h.app.evaluate(({ BrowserWindow }) => {
    const nativeSession = BrowserWindow.getAllWindows()[0].webContents.session;
    nativeSession.setPermissionCheckHandler(() => true);
    nativeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(true));
  });
  await h.reconnectFromDevicePicker();
  await h.page.locator('.ui-media-subgrid button').first().click();
  await h.tv.waitFor((state) => state.voice.samples >= 4096);
  await h.page.locator('.ui-media-subgrid button').first().click();
  const completed = await h.tv.waitFor((state) => state.voice.phase === 'ended');
  expect(completed.voice.valid).toBe(true);
});

for (const failure of ['device-unavailable', 'audio-context-start'] as const) {
  test(`VOICE-NATIVE-${failure}: negative browser OS boundary error executes production cleanup and real capture recovery`, async ({
    harness: h,
  }) => {
    await h.pair();
    await h.page.evaluate((mode) => {
      if (mode === 'device-unavailable') {
        // Negative native media provider only: no successful stream or app/business method is replaced.
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException('Synthetic missing microphone device', 'NotFoundError');
        };
      } else {
        AudioContext.prototype.resume = async () => {
          throw new DOMException('Synthetic native audio start failure', 'NotSupportedError');
        };
      }
    }, failure);
    await h.page.locator('.ui-media-subgrid button').first().click();
    await expect(h.page.locator('.ui-alert')).toBeVisible();
    await expect(h.page.locator('.ui-alert')).toContainText(
      failure === 'device-unavailable'
        ? 'Microphone unavailable: Synthetic missing microphone device'
        : 'Synthetic native audio start failure'
    );
    await expect(h.page.getByLabel('Assistant listening')).toHaveCount(0);
    expect(h.tv.snapshot().voice.bytes).toBe(0);
    expect(await h.api('hasPendingAssistantVoiceSession')).toBe(false);
    // A real renderer reload removes the negative-only native override; recovery uses actual Chromium media capture.
    await h.page.reload();
    await expect(h.page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await h.page.getByRole('button', { name: 'Devices', exact: true }).click();
    await h.page.getByRole('button').filter({ hasText: 'Synthetic TV' }).first().click();
    await h.page.locator('.ui-media-subgrid button').first().click();
    await expect(h.page.getByLabel('Assistant listening')).toBeVisible();
    await h.tv.waitFor((state) => state.voice.samples >= 4096);
    await h.page.locator('.ui-media-subgrid button').first().click();
    const state = await h.tv.waitFor((state) => state.voice.phase === 'ended');
    expect(state.voice.valid).toBe(true);
  });
}
