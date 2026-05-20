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
  }, []);

  refreshRef.current = refreshUpdaterStatusInBackground;

  useEffect(() => {
    if (!bridgeReady) return;
    const unsubscribe = getDesktopApi().onUpdaterStatus((status) => {
      setUpdaterStatus(status);
    });
    return unsubscribe;
  }, [bridgeReady]);

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
