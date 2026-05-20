/**
 * Single source of truth for every IPC channel used between the renderer and
 * the main process. PR-7 introduces this contract so that:
 *
 *   1. `src/main/preload.ts` and `src/main/main.ts` can never drift in
 *      channel names — both import the same constants.
 *   2. New code paths (PR-5 services, future device drivers, Apple TV) plug
 *      into a typed map instead of inventing free-form strings.
 *   3. A trivial parity test (`__tests__/ipcContract.test.ts`) asserts that
 *      every channel declared here is shaped correctly.
 *
 * Two kinds of channels:
 *   - INVOKE channels — request/response over `ipcMain.handle` / `ipcRenderer.invoke`.
 *   - EVENT channels  — push-only, main → renderer via `webContents.send` / `ipcRenderer.on`.
 *
 * Note: This module is intentionally **type-only at runtime** except for the
 * two frozen constant maps. The contract types reference shapes from
 * `./types` so the contract stays in sync with the DTOs.
 */
import type {
  BootstrapState,
  CommandDispatchRequest,
  CommandDropReport,
  CommandMetricsSnapshot,
  DeviceCapabilities,
  DeviceDraft,
  DeviceState,
  DiscoveredDevice,
  PairingRequest,
  SavedDevice,
  UpdaterStatus,
} from './types';

// ── INVOKE channels (request → response) ─────────────────────────────────────

/**
 * Frozen name map for every invoke channel. Use these instead of bare strings
 * so a typo is a compile error.
 */
export const INVOKE_CHANNELS = Object.freeze({
  deviceBootstrap: 'device:bootstrap',
  deviceScan: 'device:scan',
  deviceSave: 'device:save',
  deviceRemove: 'device:remove',
  deviceReset: 'device:reset',
  deviceStartPairing: 'device:startPairing',
  devicePair: 'device:pair',
  deviceConnect: 'device:connect',
  deviceDisconnect: 'device:disconnect',
  deviceCommand: 'device:command',
  deviceText: 'device:text',
  deviceCapabilities: 'device:capabilities',
  deviceAssistantVoiceStart: 'device:assistantVoiceStart',
  deviceAssistantVoiceChunk: 'device:assistantVoiceChunk',
  deviceAssistantVoiceStop: 'device:assistantVoiceStop',
  deviceAssistantVoicePending: 'device:assistantVoicePending',
  metricsRendererDrop: 'metrics:rendererDrop',
  metricsSnapshot: 'metrics:snapshot',
  updaterCheck: 'updater:check',
  updaterCheckBackground: 'updater:checkBackground',
  updaterStatus: 'updater:status',
  updaterInstall: 'updater:install',
  updaterRollback: 'updater:rollback',
} as const);

export type InvokeChannelKey = keyof typeof INVOKE_CHANNELS;
export type InvokeChannelName = (typeof INVOKE_CHANNELS)[InvokeChannelKey];

/**
 * For each invoke channel, declare its argument tuple and resolved type.
 * The handler signature is `(...args: Args) => Promise<Res>`; the renderer
 * client signature is `(...args: Args) => Promise<Res>`. The two cannot drift.
 */
export interface InvokeContract {
  deviceBootstrap: { args: []; res: BootstrapState };
  deviceScan: { args: []; res: DiscoveredDevice[] };
  deviceSave: { args: [DeviceDraft]; res: SavedDevice[] };
  deviceRemove: { args: [string]; res: SavedDevice[] };
  deviceReset: { args: []; res: DeviceState };
  deviceStartPairing: { args: [string]; res: DeviceState };
  devicePair: { args: [PairingRequest]; res: DeviceState };
  deviceConnect: { args: [string]; res: DeviceState };
  deviceDisconnect: { args: []; res: DeviceState };
  deviceCommand: { args: [CommandDispatchRequest]; res: undefined };
  deviceText: { args: [string]; res: undefined };
  deviceCapabilities: { args: []; res: DeviceCapabilities };
  deviceAssistantVoiceStart: { args: []; res: number };
  deviceAssistantVoiceChunk: { args: [number, string]; res: undefined };
  deviceAssistantVoiceStop: { args: [number]; res: undefined };
  deviceAssistantVoicePending: { args: []; res: boolean };
  metricsRendererDrop: { args: [CommandDropReport]; res: undefined };
  metricsSnapshot: { args: []; res: CommandMetricsSnapshot };
  updaterCheck: { args: []; res: UpdaterStatus };
  updaterCheckBackground: { args: []; res: UpdaterStatus };
  updaterStatus: { args: []; res: UpdaterStatus };
  updaterInstall: { args: []; res: UpdaterStatus };
  updaterRollback: { args: []; res: UpdaterStatus };
}

// Compile-time assertion: every channel key has a contract entry, and the set
// of keys is identical on both sides. If a new channel is added to
// INVOKE_CHANNELS without a matching contract entry (or vice-versa), this
// errors at build time.
type _ContractParityCheck =
  Exclude<InvokeChannelKey, keyof InvokeContract> extends never
    ? Exclude<keyof InvokeContract, InvokeChannelKey> extends never
      ? true
      : ['MISSING_CHANNEL_NAME', Exclude<keyof InvokeContract, InvokeChannelKey>]
    : ['MISSING_CONTRACT_ENTRY', Exclude<InvokeChannelKey, keyof InvokeContract>];
// Touch the type so it is not "unused" — a build error here means the map and
// contract have drifted.
const _parity: _ContractParityCheck = true;
void _parity;

// ── EVENT channels (main → renderer push) ───────────────────────────────────

export const EVENT_CHANNELS = Object.freeze({
  updaterStatusChanged: 'updater:statusChanged',
} as const);

export type EventChannelKey = keyof typeof EVENT_CHANNELS;
export type EventChannelName = (typeof EVENT_CHANNELS)[EventChannelKey];

export interface EventContract {
  updaterStatusChanged: UpdaterStatus;
}

type _EventParityCheck =
  Exclude<EventChannelKey, keyof EventContract> extends never
    ? Exclude<keyof EventContract, EventChannelKey> extends never
      ? true
      : ['MISSING_EVENT_NAME', Exclude<keyof EventContract, EventChannelKey>]
    : ['MISSING_EVENT_CONTRACT', Exclude<EventChannelKey, keyof EventContract>];
const _eventParity: _EventParityCheck = true;
void _eventParity;

// ── Helper-derived types (used by preload + main wiring) ─────────────────────

/**
 * Internal helper that maps the contract's `undefined` "no result" marker to
 * `void` at the function-signature level. Promises of `void` and promises of
 * `undefined` are not assignment-compatible in strict mode (assigning
 * `Promise<void>` to `Promise<undefined>` fails), and the renderer's call
 * sites already use `Promise<void>` for the no-result handlers, so the
 * contract internally uses `undefined` (which satisfies the no-invalid-void
 * lint rule) and the derived types surface `void`.
 */
type ResultOf<K extends InvokeChannelKey> = InvokeContract[K]['res'] extends undefined
  ? // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- deliberate; see ResultOf docblock above
    void
  : InvokeContract[K]['res'];

/** Renderer-side client signature derived from the contract. */
export type ClientApi = {
  [K in InvokeChannelKey]: (...args: InvokeContract[K]['args']) => Promise<ResultOf<K>>;
};

/** Main-side handler signature derived from the contract. */
export type HandlerApi = {
  [K in InvokeChannelKey]: (
    ...args: InvokeContract[K]['args']
  ) => ResultOf<K> | Promise<ResultOf<K>>;
};
