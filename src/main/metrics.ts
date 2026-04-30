import type {
  CommandDispatchRequest,
  CommandDropReason,
  CommandDropReport,
  CommandMetricsCounters,
  CommandMetricsRecord,
  CommandMetricsSnapshot,
  CommandMetricsTransportSnapshot,
  MetricsWarning,
} from '../shared/types';

import { isDebugTelemetryEnabled } from './debug';
import { logInfo } from './logger';

const MAX_RECENT_COMMANDS = 40;
const MAX_WARNINGS = 12;
const WARNING_DEDUP_MS = 15_000;
const CONNECT_STALL_MS = 15_000;
const SEND_STALL_MS = 15_000;
const INBOUND_STALL_MS = 45_000;

function createCounters(): CommandMetricsCounters {
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

function createTransportSnapshot(): CommandMetricsTransportSnapshot {
  return {
    socketState: 'disconnected',
    consecutiveSendFailures: 0,
    backpressureEvents: 0,
  };
}

function createEmptySnapshot(): CommandMetricsSnapshot {
  return {
    generatedAt: Date.now(),
    counters: createCounters(),
    transport: createTransportSnapshot(),
    warnings: [],
    recentCommands: [],
  };
}

class CommandMetricsStore {
  private readonly commands = new Map<string, CommandMetricsRecord>();

  private readonly counters = createCounters();

  private transport = createTransportSnapshot();

  private warnings: MetricsWarning[] = [];

  private readonly warningTimestamps = new Map<string, number>();

  recordRendererDrop(report: CommandDropReport): void {
    const record = this.ensureCommand(report);
    record.rendererDroppedAt = report.droppedAt;
    record.dropReason = report.dropReason;
    record.pendingCommandCount = report.pendingCommandCount;
    record.status = 'dropped';
    record.lastStage = 'renderer_dropped';
    record.updatedAt = report.droppedAt;
    this.counters.totalDropped += 1;
    this.counters.rendererDrops += 1;
    this.transport.lastCommandIssuedAt = report.issuedAt;
    this.logMetric('renderer_drop', {
      commandId: report.id,
      command: report.command,
      source: report.source,
      dropReason: report.dropReason,
      pendingCommandCount: report.pendingCommandCount,
      issuedAt: report.issuedAt,
      droppedAt: report.droppedAt,
    });
  }

  recordIpcReceived(request: CommandDispatchRequest): void {
    const record = this.ensureCommand(request);
    const now = Date.now();
    record.ipcReceivedAt = now;
    record.lastStage = 'ipc_received';
    record.updatedAt = now;
    this.transport.lastCommandIssuedAt = request.issuedAt;
    this.logMetric('ipc_received', {
      commandId: request.id,
      command: request.command,
      source: request.source,
      issuedAt: request.issuedAt,
      ipcReceivedAt: now,
    });
  }

  recordAdapterDispatchStart(
    request: CommandDispatchRequest,
    details?: { deviceId?: string; host?: string }
  ): void {
    const now = Date.now();
    const record = this.ensureCommand(request);
    record.deviceId = details?.deviceId ?? record.deviceId;
    record.host = details?.host ?? record.host;
    record.adapterDispatchStartedAt = now;
    record.lastStage = 'adapter_dispatch_started';
    record.updatedAt = now;
    this.logMetric('adapter_dispatch_started', {
      commandId: request.id,
      command: request.command,
      deviceId: record.deviceId,
      host: record.host,
      adapterDispatchStartedAt: now,
    });
  }

  recordAdapterDispatchCompleted(requestId: string): void {
    const record = this.commands.get(requestId);
    if (!record) {
      return;
    }

    const now = Date.now();
    record.adapterDispatchCompletedAt = now;
    if (record.status === 'pending') {
      record.lastStage = 'adapter_dispatch_completed';
    }
    record.updatedAt = now;
    this.logMetric('adapter_dispatch_completed', {
      commandId: requestId,
      adapterDispatchCompletedAt: now,
    });
  }

  recordBridgeSendStart(request: CommandDispatchRequest, host: string): void {
    const now = Date.now();
    const record = this.ensureCommand(request);
    record.host = host;
    record.bridgeSendStartedAt = now;
    record.lastStage = 'bridge_send_started';
    record.updatedAt = now;
    this.transport.currentHost = host;
    this.transport.pendingCommandId = request.id;
    this.logMetric('bridge_send_started', {
      commandId: request.id,
      command: request.command,
      host,
      bridgeSendStartedAt: now,
    });
  }

  recordConnectStarted(host: string, commandId: string): void {
    const now = Date.now();
    const record = this.commands.get(commandId);
    if (record) {
      record.host = host;
      record.connectStartedAt = now;
      record.lastStage = 'connect_started';
      record.updatedAt = now;
    }

    this.transport.socketState = 'connecting';
    this.transport.pendingConnectHost = host;
    this.transport.lastConnectStartedAt = now;
    this.transport.pendingCommandId = commandId;
    this.counters.connectAttempts += 1;
    this.logMetric('connect_started', { host, commandId, connectStartedAt: now });
  }

  recordConnectCompleted(host: string, commandId: string): void {
    const now = Date.now();
    const record = this.commands.get(commandId);
    if (record) {
      record.host = host;
      record.connectCompletedAt = now;
      record.lastStage = 'connect_completed';
      record.updatedAt = now;
    }

    this.transport.socketState = 'connected';
    this.transport.currentHost = host;
    this.transport.pendingConnectHost = undefined;
    this.transport.lastConnectCompletedAt = now;
    this.logMetric('connect_completed', { host, commandId, connectCompletedAt: now });
  }

  recordConnectFailed(host: string, commandId: string, errorMessage: string): void {
    const now = Date.now();
    const record = this.commands.get(commandId);
    if (record) {
      record.host = host;
      record.errorMessage = errorMessage;
      record.updatedAt = now;
    }

    this.transport.socketState = 'disconnected';
    this.transport.pendingConnectHost = undefined;
    this.transport.currentHost = host;
    this.counters.connectFailures += 1;
    this.logMetric('connect_failed', { host, commandId, connectFailedAt: now, errorMessage });
  }

  recordSocketWrite(
    request: CommandDispatchRequest,
    details: { host: string; buffered: boolean }
  ): void {
    const now = Date.now();
    const record = this.ensureCommand(request);
    record.host = details.host;
    record.socketWriteAt = now;
    record.socketWriteBuffered = details.buffered;
    record.lastStage = 'socket_write_completed';
    record.updatedAt = now;
    if (details.buffered) {
      this.counters.backpressureEvents += 1;
      this.transport.backpressureEvents += 1;
      this.pushWarning({
        code: 'backpressure',
        message: `Socket write buffered for ${details.host}. Commands may be delayed or dropped upstream.`,
        createdAt: now,
        host: details.host,
        commandId: request.id,
      });
    }

    this.logMetric('socket_write_completed', {
      commandId: request.id,
      command: request.command,
      host: details.host,
      socketWriteAt: now,
      buffered: details.buffered,
    });
  }

  recordSocketDrain(host: string, commandId: string): void {
    const now = Date.now();
    const record = this.commands.get(commandId);
    if (record) {
      record.socketDrainedAt = now;
      record.lastStage = 'socket_drained';
      record.updatedAt = now;
    }

    this.transport.lastSocketDrainAt = now;
    this.logMetric('socket_drain', { host, commandId, socketDrainedAt: now });
  }

  recordCommandSucceeded(requestId: string): void {
    const record = this.commands.get(requestId);
    if (!record) {
      return;
    }

    const now = Date.now();
    record.completedAt = now;
    record.status = 'sent';
    record.lastStage = 'completed';
    record.updatedAt = now;
    this.transport.pendingCommandId = undefined;
    this.transport.lastSuccessfulSendAt = now;
    this.transport.socketState = 'connected';
    this.transport.consecutiveSendFailures = 0;
    this.counters.totalSucceeded += 1;
    this.logMetric('command_completed', {
      commandId: requestId,
      command: record.command,
      host: record.host,
      completedAt: now,
      totalLatencyMs: now - record.issuedAt,
    });
  }

  recordCommandFailed(
    request: CommandDispatchRequest,
    details: {
      reason: CommandDropReason;
      errorMessage: string;
      host?: string;
      deviceId?: string;
    }
  ): void {
    const now = Date.now();
    const record = this.ensureCommand(request);
    record.host = details.host ?? record.host;
    record.deviceId = details.deviceId ?? record.deviceId;
    record.errorMessage = details.errorMessage;
    record.dropReason = details.reason;
    record.status = 'failed';
    record.lastStage = 'failed';
    record.updatedAt = now;
    record.completedAt = now;
    this.transport.pendingCommandId = undefined;
    this.transport.socketState = 'disconnected';
    this.transport.consecutiveSendFailures += 1;
    this.counters.totalFailed += 1;
    this.logMetric('command_failed', {
      commandId: request.id,
      command: request.command,
      source: request.source,
      host: record.host,
      deviceId: record.deviceId,
      failureReason: details.reason,
      errorMessage: details.errorMessage,
      failedAt: now,
      totalLatencyMs: now - request.issuedAt,
    });
  }

  recordInboundMessage(host: string): void {
    const now = Date.now();
    this.transport.currentHost = host;
    this.transport.lastInboundMessageAt = now;
    if (this.transport.socketState !== 'connecting') {
      this.transport.socketState = 'connected';
    }
  }

  recordSocketClosed(host: string): void {
    const now = Date.now();
    if (this.transport.currentHost === host || this.transport.pendingConnectHost === host) {
      this.transport.socketState = 'disconnected';
      this.transport.pendingConnectHost = undefined;
      this.transport.pendingCommandId = undefined;
    }

    this.logMetric('socket_closed', { host, closedAt: now });
  }

  getSnapshot(): CommandMetricsSnapshot {
    this.detectStalls();
    return {
      generatedAt: Date.now(),
      counters: { ...this.counters },
      transport: { ...this.transport },
      warnings: this.warnings.map((warning) => ({ ...warning })),
      recentCommands: Array.from(this.commands.values())
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_RECENT_COMMANDS)
        .map((record) => ({ ...record })),
    };
  }

  private ensureCommand(request: CommandDispatchRequest): CommandMetricsRecord {
    const existing = this.commands.get(request.id);
    if (existing) {
      return existing;
    }

    const record: CommandMetricsRecord = {
      ...request,
      updatedAt: request.issuedAt,
      status: 'pending',
      lastStage: 'ipc_received',
    };
    this.commands.set(request.id, record);
    this.counters.totalSubmitted += 1;
    this.trimCommands();
    return record;
  }

  private trimCommands(): void {
    if (this.commands.size <= MAX_RECENT_COMMANDS) {
      return;
    }

    const records = Array.from(this.commands.values()).sort(
      (left, right) => left.updatedAt - right.updatedAt
    );
    while (records.length > MAX_RECENT_COMMANDS) {
      const stale = records.shift();
      if (!stale) {
        break;
      }

      this.commands.delete(stale.id);
    }
  }

  private detectStalls(): void {
    const now = Date.now();
    if (
      this.transport.socketState === 'connecting' &&
      this.transport.lastConnectStartedAt &&
      now - this.transport.lastConnectStartedAt >= CONNECT_STALL_MS
    ) {
      this.pushWarning({
        code: 'connect_stalled',
        message: `Connection attempt to ${this.transport.pendingConnectHost ?? 'device'} has been pending for ${String(now - this.transport.lastConnectStartedAt)} ms.`,
        createdAt: now,
        host: this.transport.pendingConnectHost,
        commandId: this.transport.pendingCommandId,
      });
    }

    if (
      this.transport.pendingCommandId &&
      this.transport.lastCommandIssuedAt &&
      (!this.transport.lastSuccessfulSendAt ||
        this.transport.lastSuccessfulSendAt < this.transport.lastCommandIssuedAt) &&
      now - this.transport.lastCommandIssuedAt >= SEND_STALL_MS
    ) {
      this.pushWarning({
        code: 'send_stalled',
        message: `Command ${this.transport.pendingCommandId} has not reached a successful socket write for ${String(now - this.transport.lastCommandIssuedAt)} ms.`,
        createdAt: now,
        host: this.transport.currentHost,
        commandId: this.transport.pendingCommandId,
      });
    }

    if (
      this.transport.socketState === 'connected' &&
      this.transport.currentHost &&
      this.transport.lastInboundMessageAt &&
      now - this.transport.lastInboundMessageAt >= INBOUND_STALL_MS
    ) {
      this.pushWarning({
        code: 'no_inbound_activity',
        message: `No inbound protocol activity from ${this.transport.currentHost} for ${String(now - this.transport.lastInboundMessageAt)} ms while connected.`,
        createdAt: now,
        host: this.transport.currentHost,
      });
    }
  }

  private pushWarning(warning: MetricsWarning): void {
    const dedupeKey = `${warning.code}:${warning.host ?? ''}:${warning.commandId ?? ''}`;
    const previousTimestamp = this.warningTimestamps.get(dedupeKey);
    if (previousTimestamp && warning.createdAt - previousTimestamp < WARNING_DEDUP_MS) {
      return;
    }

    this.warningTimestamps.set(dedupeKey, warning.createdAt);
    this.warnings = [warning, ...this.warnings].slice(0, MAX_WARNINGS);
    this.counters.stallWarnings += 1;
    this.logMetric('warning', { ...warning });
  }

  private logMetric(event: string, details: Record<string, unknown>): void {
    void logInfo('metrics', event, details);
  }
}

/* eslint-disable @typescript-eslint/no-empty-function */
class NoopCommandMetricsStore {
  recordRendererDrop(_report: CommandDropReport): void {}

  recordIpcReceived(_request: CommandDispatchRequest): void {}

  recordAdapterDispatchStart(
    _request: CommandDispatchRequest,
    _details?: { deviceId?: string; host?: string }
  ): void {}

  recordAdapterDispatchCompleted(_requestId: string): void {}

  recordBridgeSendStart(_request: CommandDispatchRequest, _host: string): void {}

  recordConnectStarted(_host: string, _commandId: string): void {}

  recordConnectCompleted(_host: string, _commandId: string): void {}

  recordConnectFailed(_host: string, _commandId: string, _errorMessage: string): void {}

  recordSocketWrite(
    _request: CommandDispatchRequest,
    _details: { host: string; buffered: boolean }
  ): void {}

  recordSocketDrain(_host: string, _commandId: string): void {}

  recordCommandSucceeded(_requestId: string): void {}

  recordCommandFailed(
    _request: CommandDispatchRequest,
    _details: {
      reason: CommandDropReason;
      errorMessage: string;
      host?: string;
      deviceId?: string;
    }
  ): void {}

  recordInboundMessage(_host: string): void {}

  recordSocketClosed(_host: string): void {}

  getSnapshot(): CommandMetricsSnapshot {
    return createEmptySnapshot();
  }
}
/* eslint-enable @typescript-eslint/no-empty-function */

export const commandMetricsStore = isDebugTelemetryEnabled()
  ? new CommandMetricsStore()
  : new NoopCommandMetricsStore();
