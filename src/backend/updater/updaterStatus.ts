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
// PR-6h: still exported for test use (updaterStatus.test.ts uses it to
// build fixture states). The only *production* external caller —
// `setUpdaterStatus` in updater.ts — has been deleted.
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
  | {
      // PR-6h: distinct from check-failed (the check succeeded — the release
      // exists on GitHub — but no compatible macOS asset was found for this
      // architecture). Renderer can show "no compatible download" vs generic
      // "check failed" error differently.
      type: 'check-completed-no-asset';
      latestVersion: string;
      message: string;
    }
  | {
      type: 'check-completed-no-update';
      latestVersion: string;
      lastCheckedAt: string;
      message: string;
    }
  | {
      type: 'check-completed-update-available';
      latestVersion: string;
      lastCheckedAt: string;
      installable: boolean;
      message: string;
    }
  | { type: 'download-started'; latestVersion: string; message?: string }
  | {
      type: 'download-progress';
      progressPercent: number | undefined;
      etaSeconds: number | undefined;
      latestVersion: string;
    }
  | { type: 'install-started'; message?: string }
  | { type: 'install-completed'; latestVersion: string; message?: string }
  | { type: 'install-failed'; message: string }
  | {
      type: 'rollback-started';
      targetVersion: string;
      message?: string;
      progressPercent?: number;
    }
  | { type: 'rollback-completed'; message?: string }
  | { type: 'rollback-failed'; message: string }
  | {
      // PR-6g: distinct from rollback-failed; triggered when there's no
      // rollback bundle to roll back TO (vs an actual restore failure
      // mid-operation). The renderer can present this differently
      // (e.g. dim the rollback button instead of showing a red toast).
      type: 'rollback-unavailable';
      message: string;
    }
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
        // PR-6b: use the 3-dot ellipsis string the inline `setUpdaterStatus`
        // call sites have always used (matches the existing UX exactly).
        // PR-6h: also clear updateAvailable/updateInstallable so user can retry
        // from a no-asset state without being stuck indefinitely.
        {
          inProgress: true,
          stage: 'checking',
          message: 'Checking for updates...',
          updateAvailable: false,
          updateInstallable: false,
        },
        currentVersion
      );
    case 'check-failed':
      // PR-6d: now also clears progressPercent/etaSeconds/updateAvailable/
      // updateInstallable to match the inline setUpdaterStatus call in
      // checkForUpdatesInBackground's catch block (zero UX change for that
      // site; pre-existing tests still pass because they don't assert on
      // those fields after a failed check).
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'failed',
          progressPercent: undefined,
          etaSeconds: undefined,
          updateAvailable: false,
          updateInstallable: false,
          message: event.message,
        },
        currentVersion
      );
    case 'check-completed-no-asset':
      // PR-6h: release exists on GitHub but no compatible macOS asset found.
      // updateAvailable:true (new version exists) but updateInstallable:false
      // (can't install). stage:'failed' so the renderer shows an error state.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'failed',
          latestVersion: event.latestVersion,
          updateAvailable: true,
          updateInstallable: false,
          message: event.message,
        },
        currentVersion
      );
    case 'check-completed-no-update':
      // PR-6c: stage/progress/message exactly match the inline setUpdaterStatus
      // call site this event now replaces in updater.ts (compareVersions <= 0
      // and skipped-version branches). Renderer UX is byte-for-byte unchanged.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'completed',
          latestVersion: event.latestVersion,
          lastCheckedAt: event.lastCheckedAt,
          progressPercent: 100,
          etaSeconds: 0,
          updateAvailable: false,
          updateInstallable: false,
          // `message` is now caller-supplied so the same event covers BOTH
          // "You're up to date" AND "Update X was skipped" without 2 variants.
          message: event.message,
        },
        currentVersion
      );
    case 'check-completed-update-available':
      // PR-6c: stage matches the inline call site (`completed`, not `idle`).
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'completed',
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
          // PR-6e: caller-supplied message wins (matches existing inline
          // setUpdaterStatus message format with ASCII "..." instead of "…")
          // when migrating from installAvailableUpdate. Falls back to the
          // PR-6 default ("Downloading X…") if omitted, so existing tests
          // and any future caller that doesn't care about the format work.
          message: event.message ?? `Downloading ${event.latestVersion}…`,
        },
        currentVersion
      );
    case 'download-progress':
      // PR-6e: also keeps the "downloading" stage + UX message in sync with
      // the inline setUpdaterStatus call. Without these, a download-progress
      // event right after the user manually clicks "Check" would otherwise
      // race the stage back to 'idle'. Message format ("Downloading X... NN%")
      // matches what installAvailableUpdate's progress callback was sending.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: true,
          stage: 'downloading',
          progressPercent: event.progressPercent,
          etaSeconds: event.etaSeconds,
          message:
            event.progressPercent !== undefined
              ? `Downloading update ${event.latestVersion}... ${String(event.progressPercent)}%`
              : `Downloading update ${event.latestVersion}...`,
        },
        currentVersion
      );
    case 'install-started':
      // PR-6f: installAvailableUpdate sets progressPercent:95 + etaSeconds:10
      // inline so the download progress bar smoothly transitions past 'almost
      // done' before the install dialog appears. Reducer now sets those so
      // the migrated call site is a 1:1 swap. Caller message wins so the
      // ASCII "Installing update..." format is preserved verbatim.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: true,
          stage: 'installing',
          progressPercent: 95,
          etaSeconds: 10,
          message: event.message ?? 'Installing update…',
        },
        currentVersion
      );
    case 'install-completed':
      // PR-6f: also sets progressPercent:100 + etaSeconds:0 to match the
      // inline shape (UX wants the bar to settle at 100 % before the
      // "Relaunch now / Later" dialog). Caller message wins so the dev-mode
      // override message ("Dev mode: install step skipped.") survives.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'completed',
          progressPercent: 100,
          etaSeconds: 0,
          updateAvailable: false,
          updateInstallable: false,
          message: event.message ?? `Installed ${event.latestVersion}. Relaunching…`,
        },
        currentVersion
      );
    case 'install-failed':
      // PR-6f: also clears progressPercent/etaSeconds/updateAvailable/
      // updateInstallable to match the inline shape (UI hides the progress
      // bar and the "Update available" CTA after a failed install). Mirrors
      // PR-6d's check-failed reducer revision.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'failed',
          progressPercent: undefined,
          etaSeconds: undefined,
          updateAvailable: false,
          updateInstallable: false,
          message: event.message,
        },
        currentVersion
      );
    case 'rollback-started':
      // PR-6g: rollbackToPreviousVersion sets progressPercent:20 inline
      // to indicate visible activity while the bundle restore runs. The
      // caller-supplied message ('Rolling back to X...') wins so the
      // ASCII '...' UX format survives.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: true,
          stage: 'installing',
          progressPercent: event.progressPercent ?? 20,
          etaSeconds: undefined,
          message: event.message ?? `Rolling back to ${event.targetVersion}…`,
        },
        currentVersion
      );
    case 'rollback-completed':
      // PR-6g: rollbackToPreviousVersion also sets progressPercent:100
      // + etaSeconds:0 + clears updateAvailable/updateInstallable, since
      // any 'update available' state from before the rollback no longer
      // applies. Caller message wins so the dev-mode override
      // ('Dev mode: rollback restore skipped.') survives.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'completed',
          progressPercent: 100,
          etaSeconds: 0,
          rollbackAvailable: false,
          rollbackVersion: undefined,
          rollbackCreatedAt: undefined,
          updateAvailable: false,
          updateInstallable: false,
          message: event.message ?? 'Rollback complete. Relaunching…',
        },
        currentVersion
      );
    case 'rollback-failed':
      // PR-6g: also clears progressPercent/etaSeconds to match the inline
      // shape (UI hides the progress bar after a failed rollback). Mirrors
      // PR-6f's install-failed reducer revision.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'failed',
          progressPercent: undefined,
          etaSeconds: undefined,
          message: event.message,
        },
        currentVersion
      );
    case 'rollback-unavailable':
      // PR-6g: distinct outcome — no bundle to roll back to. Clear the
      // stale rollback metadata so the UI's "rollback available" CTA
      // disappears, set stage:'failed' so the renderer treats it as a
      // user-visible error, and pass through the caller message.
      return mergeUpdaterStatus(
        prev,
        {
          inProgress: false,
          stage: 'failed',
          rollbackAvailable: false,
          rollbackVersion: undefined,
          rollbackCreatedAt: undefined,
          message: event.message,
        },
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
