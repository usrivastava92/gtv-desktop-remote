/**
 * Pure state helpers for `UpdaterStatus`.
 *
 * Today `src/main/updater.ts` mutates a single module-level `updaterStatus`
 * object via `Object.assign(updaterStatus, partial, { currentVersion: ... })`
 * scattered across 16+ call sites. That's hard to unit-test because the live
 * Electron `app.getVersion()` and the local mutation aren't decoupled.
 *
 * PR-6a extracts the pure half into `mergeUpdaterStatus()`:
 *   - takes the current snapshot + a `Partial<UpdaterStatus>`,
 *   - returns a fresh `UpdaterStatus` (does not mutate input),
 *   - clears optional fields the caller explicitly sets to `undefined`,
 *   - lets the caller (production) pin `currentVersion` to whatever it owns
 *     (in `updater.ts` that's still `app.getVersion()`).
 *
 * `updater.ts:setUpdaterStatus` becomes a one-liner over this helper.
 *
 * PR-6b (a future follow-up) will introduce `UpdaterEvent` and
 * `applyUpdaterEvent(state, event)` to migrate call sites from
 * "merge partials" to a discriminated-union event reducer; the helper here
 * is the foundation that enables that migration to land one call site at
 * a time without breaking anything.
 */
import type { UpdaterStatus } from '../../shared/types';

/**
 * Build the initial updater status (corresponds to the inline literal in
 * `src/main/updater.ts:51`). `currentVersion` is required because there is
 * no sensible default — production passes `app.getVersion()`.
 */
export function createInitialUpdaterStatus(currentVersion: string): UpdaterStatus {
  return {
    inProgress: false,
    stage: 'idle',
    currentVersion,
    message: 'No update check has run yet.',
    updateAvailable: false,
    updateInstallable: false,
    rollbackAvailable: false,
  };
}

/**
 * Returns a new `UpdaterStatus` that is `prev` shallow-merged with `next`,
 * with `currentVersion` overridden to `currentVersionOverride` (production
 * passes `app.getVersion()`).
 *
 * Behavior parity with `setUpdaterStatus` in `src/main/updater.ts`:
 *   - All scalar fields in `next` overwrite the corresponding field on `prev`.
 *   - Optional fields explicitly set to `undefined` in `next` are *cleared*
 *     on the result (this is critical — call sites use
 *     `setUpdaterStatus({ etaSeconds: undefined })` to clear, and the merged
 *     object must reflect that). Plain `Object.assign` already preserves
 *     this semantic, so this helper does too.
 *   - `currentVersion` always equals `currentVersionOverride`, even if `next`
 *     tries to set it (matching the existing Object.assign(..., {
 *     currentVersion: app.getVersion() }) ordering).
 */
export function mergeUpdaterStatus(
  prev: UpdaterStatus,
  next: Partial<UpdaterStatus>,
  currentVersionOverride: string
): UpdaterStatus {
  return { ...prev, ...next, currentVersion: currentVersionOverride };
}

/**
 * `UpdaterEvent` is the discriminated-union form of an updater status
 * transition. PR-6b will migrate call sites to produce these events; the
 * reducer below is the consumer.
 *
 * Defined now so PR-6b is a tiny mechanical follow-up.
 */
export type UpdaterEvent =
  | { type: 'check-started' }
  | { type: 'check-failed'; message: string }
  | { type: 'check-completed-no-update'; latestVersion: string; lastCheckedAt: string }
  | {
      type: 'check-completed-update-available';
      latestVersion: string;
      lastCheckedAt: string;
      installable: boolean;
      message: string;
    }
  | { type: 'download-started'; latestVersion: string }
  | { type: 'download-progress'; progressPercent: number; etaSeconds?: number }
  | { type: 'install-started' }
  | { type: 'install-completed'; latestVersion: string }
  | { type: 'install-failed'; message: string }
  | { type: 'rollback-started' }
  | { type: 'rollback-completed' }
  | { type: 'rollback-failed'; message: string }
  | {
      type: 'rollback-availability-changed';
      available: boolean;
      version?: string;
      createdAt?: string;
    }
  | { type: 'message'; message: string };

/**
 * Pure reducer: returns a new `UpdaterStatus` for the given event. The
 * caller is responsible for stamping the current version (production passes
 * `app.getVersion()`; tests pass whatever they want).
 *
 * Tests for this reducer should consider it the canonical source of truth
 * for "what status fields does each event transition touch?".
 */
export function applyUpdaterEvent(
  prev: UpdaterStatus,
  event: UpdaterEvent,
  currentVersion: string
): UpdaterStatus {
  switch (event.type) {
    case 'check-started':
      return mergeUpdaterStatus(
        prev,
        { inProgress: true, stage: 'checking', message: 'Checking for updates…' },
        currentVersion
      );
    case 'check-failed':
      return mergeUpdaterStatus(
        prev,
        { inProgress: false, stage: 'failed', message: event.message },
        currentVersion
      );
    case 'check-completed-no-update':
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'idle',
          latestVersion: event.latestVersion,
          lastCheckedAt: event.lastCheckedAt,
          updateAvailable: false,
          updateInstallable: false,
          message: `You're on the latest version (${event.latestVersion}).`,
        },
        currentVersion
      );
    case 'check-completed-update-available':
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'idle',
          latestVersion: event.latestVersion,
          lastCheckedAt: event.lastCheckedAt,
          updateAvailable: true,
          updateInstallable: event.installable,
          message: event.message,
        },
        currentVersion
      );
    case 'download-started':
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: true,
          stage: 'downloading',
          progressPercent: 0,
          etaSeconds: undefined,
          message: `Downloading ${event.latestVersion}…`,
        },
        currentVersion
      );
    case 'download-progress':
      return mergeUpdaterStatus(
        prev,
        { progressPercent: event.progressPercent, etaSeconds: event.etaSeconds },
        currentVersion
      );
    case 'install-started':
      return mergeUpdaterStatus(
        prev,
        { inProgress: true, stage: 'installing', message: 'Installing update…' },
        currentVersion
      );
    case 'install-completed':
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'completed',
          updateAvailable: false,
          updateInstallable: false,
          message: `Installed ${event.latestVersion}. Relaunching…`,
        },
        currentVersion
      );
    case 'install-failed':
      return mergeUpdaterStatus(
        prev,
        { inProgress: false, stage: 'failed', message: event.message },
        currentVersion
      );
    case 'rollback-started':
      return mergeUpdaterStatus(
        prev,
        { inProgress: true, stage: 'installing', message: 'Rolling back to previous version…' },
        currentVersion
      );
    case 'rollback-completed':
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'completed',
          rollbackAvailable: false,
          rollbackVersion: undefined,
          rollbackCreatedAt: undefined,
          message: 'Rollback complete. Relaunching…',
        },
        currentVersion
      );
    case 'rollback-failed':
      return mergeUpdaterStatus(
        prev,
        { inProgress: false, stage: 'failed', message: event.message },
        currentVersion
      );
    case 'rollback-availability-changed':
      return mergeUpdaterStatus(
        prev,
        {
          rollbackAvailable: event.available,
          rollbackVersion: event.version,
          rollbackCreatedAt: event.createdAt,
        },
        currentVersion
      );
    case 'message':
      return mergeUpdaterStatus(prev, { message: event.message }, currentVersion);
  }
}
