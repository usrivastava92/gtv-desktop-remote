/**
 * `IMetricsRecorder` is the port that every device-side service can depend on
 * instead of importing the concrete `commandMetricsStore` singleton from
 * `src/main/metrics.ts`. introduces this interface so that future
 * extracted services (`PairingService`, `RemoteCommandService`,
 * `VoiceSessionService` /d) take metrics recording as a constructor
 * dependency, which makes them unit-testable with a fake.
 *
 * The interface mirrors the public surface of `CommandMetricsStore` and
 * `NoopCommandMetricsStore` in `src/main/metrics.ts` exactly. The existing
 * concrete classes already satisfy this shape — this file adds an explicit
 * `implements IMetricsRecorder` annotation in metrics.ts so a future drift
 * fails the build instead of silently breaking.
 *
 * Adding a new record method: add it here AND on both concrete classes.
 */
import type {
  CommandDispatchRequest,
  CommandDropReason,
  CommandDropReport,
  CommandMetricsCounters,
  CommandMetricsSnapshot,
} from '../../shared/types';

/**
 * Build an empty `CommandMetricsCounters`. Used by both the noop recorder
 * here and `src/main/metrics.ts` (which re-imports it). Centralizing the
 * "zero state" keeps the two in sync.
 */
export function createEmptyMetricsCounters(): CommandMetricsCounters {
  return {
    totalSubmitted: 0,
    totalSucceeded: 0,
    totalDropped: 0,
    totalFailed: 0,
    rendererDrops: 0,
    backpressureEvents: 0,
    connectAttempts: 0,
    connectFailures: 0,
    stallWarnings: 0,
  };
}

/** Build an empty `CommandMetricsSnapshot`. */
export function createEmptyMetricsSnapshot(): CommandMetricsSnapshot {
  return {
    generatedAt: 0,
    counters: createEmptyMetricsCounters(),
    transport: {
      socketState: 'disconnected',
      consecutiveSendFailures: 0,
      backpressureEvents: 0,
    },
    warnings: [],
    recentCommands: [],
  };
}

export interface IMetricsRecorder {
  recordRendererDrop(report: CommandDropReport): void;

  recordIpcReceived(request: CommandDispatchRequest): void;

  recordAdapterDispatchStart(
    request: CommandDispatchRequest,
    details?: { deviceId?: string; host?: string }
  ): void;

  recordAdapterDispatchCompleted(requestId: string): void;

  recordBridgeSendStart(request: CommandDispatchRequest, host: string): void;

  recordConnectStarted(host: string, commandId: string): void;

  recordConnectCompleted(host: string, commandId: string): void;

  recordConnectFailed(host: string, commandId: string, errorMessage: string): void;

  recordSocketWrite(
    request: CommandDispatchRequest,
    details: { host: string; buffered: boolean }
  ): void;

  recordSocketDrain(host: string, commandId: string): void;

  recordCommandSucceeded(requestId: string): void;

  recordCommandFailed(
    request: CommandDispatchRequest,
    details: {
      reason: CommandDropReason;
      errorMessage: string;
      host?: string;
      deviceId?: string;
    }
  ): void;

  recordInboundMessage(host: string): void;

  recordSocketClosed(host: string): void;

  getSnapshot(): CommandMetricsSnapshot;
}

/**
 * A no-op `IMetricsRecorder`. Useful as a default in tests or in code paths
 * where metrics aren't needed. The empty `getSnapshot()` returns the same
 * empty snapshot that production's `NoopCommandMetricsStore` returns.
 *
 * Production code SHOULD prefer the singleton in `src/main/metrics.ts` or
 * `createCommandMetricsStore()` factory — this is for tests only.
 */
/* eslint-disable @typescript-eslint/no-empty-function -- deliberate no-ops */
export function createSilentMetricsRecorder(): IMetricsRecorder {
  return {
    recordRendererDrop: () => {},
    recordIpcReceived: () => {},
    recordAdapterDispatchStart: () => {},
    recordAdapterDispatchCompleted: () => {},
    recordBridgeSendStart: () => {},
    recordConnectStarted: () => {},
    recordConnectCompleted: () => {},
    recordConnectFailed: () => {},
    recordSocketWrite: () => {},
    recordSocketDrain: () => {},
    recordCommandSucceeded: () => {},
    recordCommandFailed: () => {},
    recordInboundMessage: () => {},
    recordSocketClosed: () => {},
    getSnapshot: () => createEmptyMetricsSnapshot(),
  };
}
/* eslint-enable @typescript-eslint/no-empty-function */
