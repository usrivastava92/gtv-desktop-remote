import { describe, expect, it } from 'vitest';

import type { UpdaterStatus } from '../../../shared/types';
import {
  applyUpdaterEvent,
  createInitialUpdaterStatus,
  mergeUpdaterStatus,
  type UpdaterEvent,
} from '../updaterStatus';

const V = '1.2.3';

describe('createInitialUpdaterStatus', () => {
  it('matches the inline initial state in src/main/updater.ts', () => {
    expect(createInitialUpdaterStatus(V)).toEqual<UpdaterStatus>({
      inProgress: false,
      stage: 'idle',
      currentVersion: V,
      message: 'No update check has run yet.',
      updateAvailable: false,
      updateInstallable: false,
      rollbackAvailable: false,
    });
  });

  it('returns fresh objects (no shared mutable state)', () => {
    const a = createInitialUpdaterStatus(V);
    const b = createInitialUpdaterStatus(V);
    a.message = 'mutated';
    expect(b.message).toBe('No update check has run yet.');
  });
});

describe('mergeUpdaterStatus', () => {
  const base = createInitialUpdaterStatus(V);

  it('overwrites scalar fields from `next`', () => {
    const merged = mergeUpdaterStatus(base, { stage: 'checking', inProgress: true }, V);
    expect(merged.stage).toBe('checking');
    expect(merged.inProgress).toBe(true);
    expect(merged.message).toBe(base.message); // untouched
  });

  it('always pins currentVersion to the override (ignores next.currentVersion)', () => {
    const merged = mergeUpdaterStatus(base, { currentVersion: 'wrong' }, '9.9.9');
    expect(merged.currentVersion).toBe('9.9.9');
  });

  it('returns a fresh object (does not mutate prev)', () => {
    const merged = mergeUpdaterStatus(base, { stage: 'checking' }, V);
    expect(merged).not.toBe(base);
    expect(base.stage).toBe('idle');
  });

  it('clears optional fields explicitly set to undefined', () => {
    const withProgress = mergeUpdaterStatus(base, { progressPercent: 50, etaSeconds: 30 }, V);
    expect(withProgress.progressPercent).toBe(50);

    const cleared = mergeUpdaterStatus(
      withProgress,
      { progressPercent: undefined, etaSeconds: undefined },
      V
    );
    expect(cleared.progressPercent).toBeUndefined();
    expect(cleared.etaSeconds).toBeUndefined();
  });
});

describe('applyUpdaterEvent — every event transition', () => {
  const initial = createInitialUpdaterStatus(V);

  it('check-started → in-progress + checking + "Checking…" message', () => {
    const next = applyUpdaterEvent(initial, { type: 'check-started' }, V);
    expect(next).toMatchObject({ inProgress: true, stage: 'checking' });
    expect(next.message).toContain('Checking');
  });

  it('check-failed → !inProgress + failed + carries message', () => {
    const next = applyUpdaterEvent(initial, { type: 'check-failed', message: 'boom' }, V);
    expect(next).toMatchObject({ inProgress: false, stage: 'failed', message: 'boom' });
  });

  it('check-completed-no-update → idle + sets latestVersion + lastCheckedAt + cleared availability', () => {
    const next = applyUpdaterEvent(
      initial,
      {
        type: 'check-completed-no-update',
        latestVersion: '1.2.4',
        lastCheckedAt: '2025-01-01T00:00:00Z',
      },
      V
    );
    expect(next.latestVersion).toBe('1.2.4');
    expect(next.lastCheckedAt).toBe('2025-01-01T00:00:00Z');
    expect(next.updateAvailable).toBe(false);
    expect(next.updateInstallable).toBe(false);
    expect(next.message).toContain('1.2.4');
  });

  it('check-completed-update-available → idle + updateAvailable=true + installable mirrored', () => {
    const next = applyUpdaterEvent(
      initial,
      {
        type: 'check-completed-update-available',
        latestVersion: '2.0.0',
        lastCheckedAt: '2025-01-01T00:00:00Z',
        installable: true,
        message: 'Update available: 2.0.0',
      },
      V
    );
    expect(next.updateAvailable).toBe(true);
    expect(next.updateInstallable).toBe(true);
    expect(next.latestVersion).toBe('2.0.0');
    expect(next.message).toBe('Update available: 2.0.0');
  });

  it('download-started → downloading + zeros progress + clears eta + message includes version', () => {
    const after = applyUpdaterEvent(
      initial,
      { type: 'download-progress', progressPercent: 99, etaSeconds: 4 },
      V
    );
    const next = applyUpdaterEvent(after, { type: 'download-started', latestVersion: '2.0.0' }, V);
    expect(next).toMatchObject({ inProgress: true, stage: 'downloading', progressPercent: 0 });
    expect(next.etaSeconds).toBeUndefined();
    expect(next.message).toContain('2.0.0');
  });

  it('download-progress → updates progress and eta only', () => {
    const next = applyUpdaterEvent(
      initial,
      { type: 'download-progress', progressPercent: 42, etaSeconds: 17 },
      V
    );
    expect(next.progressPercent).toBe(42);
    expect(next.etaSeconds).toBe(17);
    expect(next.stage).toBe(initial.stage); // unchanged
  });

  it('install-started / install-completed / install-failed transitions', () => {
    const started = applyUpdaterEvent(initial, { type: 'install-started' }, V);
    expect(started).toMatchObject({ inProgress: true, stage: 'installing' });

    const completed = applyUpdaterEvent(
      started,
      { type: 'install-completed', latestVersion: '2.0.0' },
      V
    );
    expect(completed).toMatchObject({
      inProgress: false,
      stage: 'completed',
      updateAvailable: false,
      updateInstallable: false,
    });
    expect(completed.message).toContain('2.0.0');

    const failed = applyUpdaterEvent(started, { type: 'install-failed', message: 'disk full' }, V);
    expect(failed).toMatchObject({ inProgress: false, stage: 'failed', message: 'disk full' });
  });

  it('rollback transitions clear rollback metadata on completion', () => {
    const withRollback = applyUpdaterEvent(
      initial,
      {
        type: 'rollback-availability-changed',
        available: true,
        version: '1.2.2',
        createdAt: '2024-12-01T00:00:00Z',
      },
      V
    );
    expect(withRollback.rollbackAvailable).toBe(true);
    expect(withRollback.rollbackVersion).toBe('1.2.2');

    const completed = applyUpdaterEvent(withRollback, { type: 'rollback-completed' }, V);
    expect(completed.rollbackAvailable).toBe(false);
    expect(completed.rollbackVersion).toBeUndefined();
    expect(completed.rollbackCreatedAt).toBeUndefined();
    expect(completed.stage).toBe('completed');
  });

  it('rollback-failed → !inProgress + failed', () => {
    const next = applyUpdaterEvent(initial, { type: 'rollback-failed', message: 'no backup' }, V);
    expect(next).toMatchObject({ inProgress: false, stage: 'failed', message: 'no backup' });
  });

  it('rollback-availability-changed toggles availability fields independently of stage', () => {
    const enabled = applyUpdaterEvent(
      initial,
      {
        type: 'rollback-availability-changed',
        available: true,
        version: '1.1.0',
        createdAt: '2024-11-01T00:00:00Z',
      },
      V
    );
    expect(enabled.stage).toBe(initial.stage);
    expect(enabled.rollbackAvailable).toBe(true);

    const disabled = applyUpdaterEvent(
      enabled,
      { type: 'rollback-availability-changed', available: false },
      V
    );
    expect(disabled.rollbackAvailable).toBe(false);
    expect(disabled.rollbackVersion).toBeUndefined();
  });

  it('message-only event updates message and nothing else', () => {
    const next = applyUpdaterEvent(initial, { type: 'message', message: 'idle' }, V);
    expect(next.message).toBe('idle');
    expect(next.stage).toBe(initial.stage);
  });

  it('every event preserves currentVersion = override', () => {
    const events: UpdaterEvent[] = [
      { type: 'check-started' },
      { type: 'install-completed', latestVersion: '2.0.0' },
      { type: 'rollback-availability-changed', available: false },
      { type: 'message', message: 'hi' },
    ];
    for (const ev of events) {
      const next = applyUpdaterEvent(initial, ev, '9.9.9');
      expect(next.currentVersion).toBe('9.9.9');
    }
  });

  it('reducer is pure: never mutates prev', () => {
    const before = { ...initial };
    applyUpdaterEvent(initial, { type: 'install-started' }, V);
    expect(initial).toEqual(before);
  });
});
