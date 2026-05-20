// PR-renderer-3 (Wave 14): extract updater status management from App.tsx.
//
// This hook owns:
//   - the UpdaterStatus state slice
//   - the onUpdaterStatus push subscription (from PR QW-2 / Wave 4)
//   - the refreshUpdaterStatusInBackground helper
//   - the rollback-version-changed side effect
//     (clear suppressed/dismissed when the backup rotates)
//   - initialUpdaterStatus value so App.tsx has zero knowledge of the shape
//
// App.tsx uses this as:
//   const { updaterStatus, refreshUpdaterStatusInBackground } = useUpdaterStatus(bridgeReady);
//
// The hook is tested in src/renderer/hooks/__tests__/useUpdaterStatus.test.tsx
// using the jsdom + RTL harness from PR-renderer-infra.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getDesktopApi, type UpdaterStatus } from '../api';

export const INITIAL_UPDATER_STATUS: UpdaterStatus = {
  inProgress: false,
  stage: 'idle',
  currentVersion: 'unknown',
  message: 'Loading update status...',
  updateAvailable: false,
  updateInstallable: false,
  rollbackAvailable: false,
};

/**
 * Manages the updater status state slice and its subscriptions.
 *
 * @param bridgeReady - whether the IPC bridge is ready to receive calls.
 *   The push subscription is only attached after the bridge is ready.
 * @param suppressedRollbackVersion - the version the user suppressed
 *   ("don't show again"). Passed in from App so the hook can clear it
 *   when a *different* rollback backup becomes available.
 * @param onSuppressedRollbackVersionChanged - callback to clear the
 *   suppressed version from App's state + localStorage.
 * @param dismissedRollbackVersion - the version the user dismissed for
 *   this session.
 * @param onDismissedRollbackVersionChanged - callback to clear the
 *   dismissed version from App's state.
 */
export function useUpdaterStatus(
  bridgeReady: boolean,
  suppressedRollbackVersion: string | null,
  onSuppressedRollbackVersionChanged: (version: string | null) => void,
  dismissedRollbackVersion: string | null,
  onDismissedRollbackVersionChanged: (version: string | null) => void
) {
  // Return type is inferred by TS — avoids importing React.Dispatch explicitly.
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus>(INITIAL_UPDATER_STATUS);

  // Stable callback ref so the useEffect cleanup path doesn't capture a
  // stale closure (the refresh function itself calls getDesktopApi() inline).
  const refreshRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const refreshUpdaterStatusInBackground = useCallback(async () => {
    try {
      const nextStatus = await getDesktopApi().checkForUpdatesInBackground();
      setUpdaterStatus(nextStatus);
    } catch (error) {
      setUpdaterStatus((current) => ({
        ...current,
        inProgress: false,
        stage: 'failed',
        message: (error as Error).message || 'Update check failed.',
      }));
    }
    // getDesktopApi() reads window.gtvRemote at call time so no deps needed.
    // setUpdaterStatus is stable (from useState). ESLint exhaustive-deps
    // wants [] and that's correct here.
  }, []);

  refreshRef.current = refreshUpdaterStatusInBackground;

  // Subscribe to push events from the main process.
  // onUpdaterStatus was wired up in PR QW-2 (Wave 4) — the main process
  // broadcasts on every status mutation so the renderer reacts immediately
  // without polling.
  useEffect(() => {
    if (!bridgeReady) return;
    const unsubscribe = getDesktopApi().onUpdaterStatus((status) => {
      setUpdaterStatus(status);
    });
    return unsubscribe;
  }, [bridgeReady]);

  // If the rollback version changes (e.g. user installed a new update so a
  // new previous-version backup is now on disk), forget any prior
  // "Don't show again" / "Dismissed" choice so the banner re-appears.
  useEffect(() => {
    const rollbackVersion = updaterStatus.rollbackVersion;
    if (!rollbackVersion) return;

    if (suppressedRollbackVersion && suppressedRollbackVersion !== rollbackVersion) {
      onSuppressedRollbackVersionChanged(null);
      try {
        window.localStorage.removeItem('gtv-remote.suppressedRollbackVersion');
      } catch {
        // Ignore storage failures.
      }
    }
    if (dismissedRollbackVersion && dismissedRollbackVersion !== rollbackVersion) {
      onDismissedRollbackVersionChanged(null);
    }
  }, [
    updaterStatus.rollbackVersion,
    suppressedRollbackVersion,
    onSuppressedRollbackVersionChanged,
    dismissedRollbackVersion,
    onDismissedRollbackVersionChanged,
  ]);

  return { updaterStatus, setUpdaterStatus, refreshUpdaterStatusInBackground };
}
