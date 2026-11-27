import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from './app-harness';

test('PAIR-CHECKSUM: rendered checksum failure requests a fresh code and valid retry controls the TV', async ({
  harness: h,
}) => {
  const device = await h.preparePairing();
  await h.openPairing();
  const input = h.page.locator('input[autocomplete="one-time-code"]');
  const valid = h.tv.pairingCode;
  const invalid = `${valid[0] === 'A' ? 'B' : 'A'}${valid.slice(1)}`;
  const traceStart = h.tv.traces.length;
  const sessionsBeforeRetry = h.tv.snapshot().pairingSessions;
  await input.fill(invalid);
  await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(h.page.locator('.ui-alert')).toContainText('certificate hash validation');
  await expect(
    h.page.getByRole('heading', { name: 'New Devices Found', exact: true })
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  expect((await h.api('bootstrap')).deviceState.status).toBe('error');
  expect(
    (await h.api('bootstrap')).devices.find((item) => item.id === device.id)?.isPaired
  ).not.toBe(true);
  expect(h.tv.snapshot().pairedClients).toBe(0);
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

  await h.openPairing();
  expect(h.tv.snapshot().pairingSessions).toBe(sessionsBeforeRetry + 1);
  await expect(input).toHaveValue('');
  await expect(h.page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await input.fill(h.tv.pairingCode);
  await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await h.tv.waitFor((state) => state.ready && state.pairedClients === 1);
  expect((await h.api('bootstrap')).deviceState.status).toBe('connected');
  await h.page.getByRole('button', { name: 'Select', exact: true }).click();
  await h.tv.waitFor((state) => state.selected === 1);
});

test('PAIR-CERTIFICATE-REJECTION: replaced app credential cannot reuse paired authorization', async ({
  harness: h,
}) => {
  const device = await h.pair();
  await h.api('disconnect');
  const certificate = await h.certificate();
  const directory = path.join(h.profile, 'androidtvremote');
  const files = await readdir(directory);
  await h.app.close();
  for (const file of files.filter((file) => file.endsWith('.pem')))
    await rm(path.join(directory, file));
  await h.launch();
  await expect(h.api('connect', device.id)).rejects.toThrow();
  expect((await h.api('bootstrap')).deviceState.status).toBe('error');
  expect(await h.certificate()).not.toBe(certificate);
  expect(h.tv.snapshot().ready).toBe(false);
  expect(h.tv.traces.some((trace) => trace.service === 'tls' && trace.direction === 'error')).toBe(
    true
  );
  // Restoring only the public certificate cannot authorize its mismatched generated private key.
  const name = (await readdir(directory)).find((file) => file.endsWith('.cert.pem'));
  if (!name) throw new Error('Replacement certificate missing');
  expect(await readFile(path.join(directory, name), 'utf8')).not.toBe(certificate);
});

test('PAIR-UI-NONHEX: malformed user input cannot submit a six-hex exchange', async ({
  harness: h,
}) => {
  await h.preparePairing();
  await h.openPairing();
  const input = h.page.locator('input[autocomplete="one-time-code"]');
  await input.fill('OO00FF');
  await expect(input).toHaveValue('00FF');
  await expect(h.page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await input.fill(h.tv.pairingCode);
  await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await h.tv.waitFor((state) => state.ready);
});
