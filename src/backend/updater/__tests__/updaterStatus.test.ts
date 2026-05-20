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

  it('check-failed → clears progressPercent/etaSeconds/updateAvailable/updateInstallable (PR-6d)', () => {
    // Seed state as if a check had previously found an installable update.
    const dirty = applyUpdaterEvent(
      initial,
      {
        type: 'check-completed-update-available',
        latestVersion: '1.5.0',
        lastCheckedAt: '2025-01-01T00:00:00Z',
        installable: true,
        message: 'Update 1.5.0 is available.',
      },
      V
    );
    expect(dirty.updateAvailable).toBe(true);
    expect(dirty.updateInstallable).toBe(true);
    // A subsequent failed check (e.g. network outage during background poll)
    // must wipe those flags so the UI doesn't show a stale "available" CTA.
    const failed = applyUpdaterEvent(dirty, { type: 'check-failed', message: 'network down' }, V);
    expect(failed.inProgress).toBe(false);
    expect(failed.stage).toBe('failed');
    expect(failed.progressPercent).toBeUndefined();
    expect(failed.etaSeconds).toBeUndefined();
    expect(failed.updateAvailable).toBe(false);
    expect(failed.updateInstallable).toBe(false);
    expect(failed.message).toBe('network down');
  });

  it('check-failed → !inProgress + failed + carries message', () => {
    const next = applyUpdaterEvent(initial, { type: 'check-failed', message: 'boom' }, V);
    expect(next).toMatchObject({ inProgress: false, stage: 'failed', message: 'boom' });
  });

  it('check-completed-no-update → completed + sets latestVersion + lastCheckedAt + cleared availability + caller-supplied message', () => {
    // PR-6c: `message` is now caller-supplied so the same event covers
    // "up to date" AND "skipped" without 2 variants. Stage/progress/eta
    // match the production setUpdaterStatus call sites exactly.
    const next = applyUpdaterEvent(
      initial,
      {
        type: 'check-completed-no-update',
        latestVersion: '1.2.4',
        lastCheckedAt: '2025-01-01T00:00:00Z',
        message: "You're up to date (1.2.3).",
      },
      V
    );
    expect(next.stage).toBe('completed');
    expect(next.progressPercent).toBe(100);
    expect(next.etaSeconds).toBe(0);
    expect(next.latestVersion).toBe('1.2.4');
    expect(next.lastCheckedAt).toBe('2025-01-01T00:00:00Z');
    expect(next.updateAvailable).toBe(false);
    expect(next.updateInstallable).toBe(false);
    expect(next.message).toBe("You're up to date (1.2.3).");
  });

  it('check-completed-no-update → also fits the "skipped" UX with a different message', () => {
    // Verifies the same event covers the skipped-version branch in updater.ts
    // without needing a separate `check-completed-skipped` event.
    const next = applyUpdaterEvent(
      initial,
      {
        type: 'check-completed-no-update',
        latestVersion: '2.0.0',
        lastCheckedAt: '2025-01-01T00:00:00Z',
        message: 'Update 2.0.0 was skipped.',
      },
      V
    );
    expect(next.message).toBe('Update 2.0.0 was skipped.');
    expect(next.stage).toBe('completed');
    expect(next.updateAvailable).toBe(false);
  });

  it('check-completed-update-available → completed + updateAvailable=true + installable mirrored', () => {
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
      {
        type: 'download-progress',
        progressPercent: 99,
        etaSeconds: 4,
        latestVersion: '1.2.3',
      },
      V
    );
    const next = applyUpdaterEvent(after, { type: 'download-started', latestVersion: '2.0.0' }, V);
    expect(next).toMatchObject({ inProgress: true, stage: 'downloading', progressPercent: 0 });
    expect(next.etaSeconds).toBeUndefined();
    expect(next.message).toContain('2.0.0');
  });

  it('download-started → caller-supplied message wins (PR-6e UX-parity)', () => {
    const next = applyUpdaterEvent(
      initial,
      {
        type: 'download-started',
        latestVersion: '2.0.0',
        message: 'Downloading update 2.0.0...',
      },
      V
    );
    // ASCII "..." vs the default "Downloading X…" with ellipsis; caller wins.
    expect(next.message).toBe('Downloading update 2.0.0...');
  });

  it('download-progress → sets stage:downloading + UX message + progress + eta (PR-6e)', () => {
    const next = applyUpdaterEvent(
      initial,
      {
        type: 'download-progress',
        progressPercent: 42,
        etaSeconds: 17,
        latestVersion: '1.2.3',
      },
      V
    );
    expect(next.progressPercent).toBe(42);
    expect(next.etaSeconds).toBe(17);
    // PR-6e: stage and UX message are now derived from the event so the
    // installAvailableUpdate progress callback doesn't have to set them
    // inline. Matches the prior inline setUpdaterStatus shape.
    expect(next.inProgress).toBe(true);
    expect(next.stage).toBe('downloading');
    expect(next.message).toBe('Downloading update 1.2.3... 42%');
  });

  it('download-progress → undefined progressPercent uses fallback message (PR-6e)', () => {
    const next = applyUpdaterEvent(
      initial,
      {
        type: 'download-progress',
        progressPercent: undefined,
        etaSeconds: undefined,
        latestVersion: '1.2.3',
      },
      V
    );
    expect(next.progressPercent).toBeUndefined();
    expect(next.etaSeconds).toBeUndefined();
    expect(next.message).toBe('Downloading update 1.2.3...');
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

  it('install-started → sets progress:95 + eta:10 + caller-supplied message (PR-6f UX-parity)', () => {
    // installAvailableUpdate transitions the download bar through 95 %
    // before showing the install dialog. The ASCII '...' format (vs the
    // default '…' ellipsis) is the caller's exact UX.
    const next = applyUpdaterEvent(
      initial,
      { type: 'install-started', message: 'Installing update...' },
      V
    );
    expect(next).toMatchObject({
      inProgress: true,
      stage: 'installing',
      progressPercent: 95,
      etaSeconds: 10,
      message: 'Installing update...',
    });
  });

  it('install-completed → sets progress:100 + eta:0 + honors dev-mode message (PR-6f UX-parity)', () => {
    // installAvailableUpdate branches the message for the dev-updater
    // override; the reducer must accept the caller value verbatim.
    const next = applyUpdaterEvent(
      initial,
      {
        type: 'install-completed',
        latestVersion: '2.0.0',
        message: 'Dev mode: install step skipped.',
      },
      V
    );
    expect(next).toMatchObject({
      inProgress: false,
      stage: 'completed',
      progressPercent: 100,
      etaSeconds: 0,
      updateAvailable: false,
      updateInstallable: false,
      message: 'Dev mode: install step skipped.',
    });
  });

  it('install-failed → clears progress/eta/updateAvailable/updateInstallable (PR-6f)', () => {
    // Mirrors PR-6d's check-failed shape: a failed install must hide the
    // progress bar and the 'Update available' CTA so the user can re-run
    // the check from a clean state.
    const downloading = applyUpdaterEvent(
      initial,
      {
        type: 'download-progress',
        progressPercent: 70,
        etaSeconds: 5,
        latestVersion: '2.0.0',
      },
      V
    );
    const next = applyUpdaterEvent(downloading, { type: 'install-failed', message: 'oom' }, V);
    expect(next).toMatchObject({
      inProgress: false,
      stage: 'failed',
      message: 'oom',
      updateAvailable: false,
      updateInstallable: false,
    });
    expect(next.progressPercent).toBeUndefined();
    expect(next.etaSeconds).toBeUndefined();
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

  it('rollback-started → progress:20 + caller message + targetVersion fallback (PR-6g)', () => {
    // rollbackToPreviousVersion sets progressPercent:20 inline to show
    // visible activity while the bundle restore runs. Caller message
    // wins (ASCII '...' format from the prod call site).
    const next = applyUpdaterEvent(
      initial,
      {
        type: 'rollback-started',
        targetVersion: '1.2.2',
        message: 'Rolling back to 1.2.2...',
        progressPercent: 20,
      },
      V
    );
    expect(next).toMatchObject({
      inProgress: true,
      stage: 'installing',
      progressPercent: 20,
      message: 'Rolling back to 1.2.2...',
    });
    expect(next.etaSeconds).toBeUndefined();

    // Default fallback message uses ellipsis when caller omits one.
    const defaulted = applyUpdaterEvent(
      initial,
      { type: 'rollback-started', targetVersion: '1.2.2' },
      V
    );
    expect(defaulted.message).toContain('1.2.2');
  });

  it('rollback-completed → progress:100 + eta:0 + clears updateAvailable + honors dev-mode message (PR-6g)', () => {
    // Dev-mode override branch from rollbackToPreviousVersion must
    // survive the migration. Also clears updateAvailable/updateInstallable
    // because any "update available" state from before the rollback no
    // longer applies post-restore.
    const dirty = applyUpdaterEvent(
      initial,
      {
        type: 'check-completed-update-available',
        latestVersion: '2.0.0',
        lastCheckedAt: '2024-12-01T00:00:00Z',
        installable: true,
        message: 'Update 2.0.0 is available.',
      },
      V
    );
    const next = applyUpdaterEvent(
      dirty,
      {
        type: 'rollback-completed',
        message: 'Dev mode: rollback restore skipped.',
      },
      V
    );
    expect(next).toMatchObject({
      inProgress: false,
      stage: 'completed',
      progressPercent: 100,
      etaSeconds: 0,
      updateAvailable: false,
      updateInstallable: false,
      message: 'Dev mode: rollback restore skipped.',
    });
  });

  it('rollback-failed → clears progress/eta (PR-6g)', () => {
    const inProgress = applyUpdaterEvent(
      initial,
      { type: 'rollback-started', targetVersion: '1.2.2', progressPercent: 20 },
      V
    );
    const next = applyUpdaterEvent(
      inProgress,
      { type: 'rollback-failed', message: 'restore IO error' },
      V
    );
    expect(next).toMatchObject({
      inProgress: false,
      stage: 'failed',
      message: 'restore IO error',
    });
    expect(next.progressPercent).toBeUndefined();
    expect(next.etaSeconds).toBeUndefined();
  });

  it('rollback-unavailable → stage:failed + clears rollback metadata + passes message (PR-6g)', () => {
    // New variant: distinct from rollback-failed. Means there's no
    // bundle to roll back to (vs an actual restore failure mid-op).
    // Renderer can dim the rollback button instead of showing a red
    // toast.
    const withRollback = applyUpdaterEvent(
      initial,
      {
        type: 'rollback-availability-changed',
        available: true,
        version: '1.1.0',
        createdAt: '2024-11-01T00:00:00Z',
      },
      V
    );
    const next = applyUpdaterEvent(
      withRollback,
      {
        type: 'rollback-unavailable',
        message: 'No previous version backup is available.',
      },
      V
    );
    expect(next).toMatchObject({
      inProgress: false,
      stage: 'failed',
      rollbackAvailable: false,
      message: 'No previous version backup is available.',
    });
    expect(next.rollbackVersion).toBeUndefined();
    expect(next.rollbackCreatedAt).toBeUndefined();
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
