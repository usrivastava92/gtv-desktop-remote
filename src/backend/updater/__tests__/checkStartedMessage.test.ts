import { describe, expect, it } from 'vitest';

import { applyUpdaterEvent, createInitialUpdaterStatus } from '../updaterStatus';

/**
 * PR-6b: lock down the exact UX strings that the renderer displays. The first
 * migrated call site (`checkForMacUpdate` → `dispatchUpdaterEvent({ type: 'check-started' })`)
 * MUST emit the same `message` field the previous inline
 * `setUpdaterStatus({ message: 'Checking for updates...' })` did, or users
 * will see the message flicker on every update check.
 */
describe('UX-parity: exact message strings', () => {
  const initial = createInitialUpdaterStatus('1.0.0');

  it('check-started message exactly matches the previous inline string', () => {
    const next = applyUpdaterEvent(initial, { type: 'check-started' }, '1.0.0');
    expect(next.message).toBe('Checking for updates...');
  });

  it('check-started preserves currentVersion', () => {
    const next = applyUpdaterEvent(initial, { type: 'check-started' }, '9.9.9');
    expect(next.currentVersion).toBe('9.9.9');
  });

  it('two consecutive check-started events are idempotent on stage/message', () => {
    const a = applyUpdaterEvent(initial, { type: 'check-started' }, '1.0.0');
    const b = applyUpdaterEvent(a, { type: 'check-started' }, '1.0.0');
    expect(b.stage).toBe('checking');
    expect(b.message).toBe(a.message);
    expect(b.inProgress).toBe(true);
  });
});
