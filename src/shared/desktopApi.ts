/**
 * `DesktopApi` is the typed surface that the renderer sees on
 * `window.gtvRemote`. It is derived from the IPC contract in `ipcContract.ts`
 * so the renderer and preload can never drift on shape.
 *
 * Two parts:
 *
 *   1. The INVOKE half: every key in `INVOKE_CHANNELS` has a corresponding
 *      method, generated from `ClientApi`. But the renderer-facing API uses
 *      friendlier names (e.g. `bootstrap` instead of `deviceBootstrap`).
 *      We keep the friendly-name mapping in `InvokeMethodMap` below so the
 *      preload implementation and the renderer's call sites stay readable.
 *
 *   2. The EVENT half: `onXxx(listener): () => void` subscription methods,
 *      one per `EVENT_CHANNELS` entry. These are not covered by `ClientApi`
 *      because they are not request/response — they are push-only.
 *
 * Defining the type here (in `shared/`) instead of in `main/preload.ts`
 * removes the cross-layer import from the renderer (`vite-env.d.ts`
 * previously imported from `'../main/preload'`, which is a layering
 * violation that ESLint will eventually forbid).
 */
import type { ClientApi, InvokeChannelKey } from './ipcContract';
import type { UpdaterStatus } from './types';

/**
 * Friendly renderer-facing method names mapped onto the contract keys. The
 * preload layer constructs an object whose keys are these friendly names and
 * whose method bodies invoke the corresponding `INVOKE_CHANNELS[Key]`.
 *
 * Adding a new IPC channel: add the friendly name → contract key here, and
 * the type system forces preload and the renderer to follow.
 */
export interface InvokeMethodMap {
  bootstrap: 'deviceBootstrap';
  scanDevices: 'deviceScan';
  saveDevice: 'deviceSave';
  removeDevice: 'deviceRemove';
  resetState: 'deviceReset';
  startPairing: 'deviceStartPairing';
  pair: 'devicePair';
  connect: 'deviceConnect';
  disconnect: 'deviceDisconnect';
  sendCommand: 'deviceCommand';
  recordCommandDrop: 'metricsRendererDrop';
  getMetricsSnapshot: 'metricsSnapshot';
  sendText: 'deviceText';
  startAssistantVoice: 'deviceAssistantVoiceStart';
  sendAssistantVoiceChunk: 'deviceAssistantVoiceChunk';
  stopAssistantVoice: 'deviceAssistantVoiceStop';
  hasPendingAssistantVoiceSession: 'deviceAssistantVoicePending';
  capabilities: 'deviceCapabilities';
  checkForUpdates: 'updaterCheck';
  checkForUpdatesInBackground: 'updaterCheckBackground';
  getUpdaterStatus: 'updaterStatus';
  installAvailableUpdate: 'updaterInstall';
  rollbackToPreviousVersion: 'updaterRollback';
}

// Compile-time check: the friendly map covers every contract key exactly once.
type _InvokeMapKeys = InvokeMethodMap[keyof InvokeMethodMap];
type _MissingFriendly = Exclude<InvokeChannelKey, _InvokeMapKeys>;
type _ExtraFriendly = Exclude<_InvokeMapKeys, InvokeChannelKey>;
type _InvokeMapParity = _MissingFriendly extends never
  ? _ExtraFriendly extends never
    ? true
    : ['EXTRA_FRIENDLY_NAME', _ExtraFriendly]
  : ['MISSING_FRIENDLY_NAME_FOR', _MissingFriendly];
const _invokeMapParity: _InvokeMapParity = true;
void _invokeMapParity;

/** Renderer-side typed surface for the INVOKE half. */
export type DesktopInvokeApi = {
  [Friendly in keyof InvokeMethodMap]: ClientApi[InvokeMethodMap[Friendly]];
};

/** Renderer-side typed surface for the EVENT (push) half. */
export interface DesktopEventApi {
  /**
   * Subscribe to updater status updates. Returns an unsubscribe function;
   * callers MUST call it on unmount.
   */
  onUpdaterStatus(listener: (status: UpdaterStatus) => void): () => void;
}

/** The full `window.gtvRemote` surface. */
export type DesktopApi = DesktopInvokeApi & DesktopEventApi;
