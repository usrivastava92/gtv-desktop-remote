/**
 * `VoiceSessionService` owns the lifecycle of an assistant-voice session
 * against a single connected device. It was extracted from
 * `GoogleTvAdapter.{start,send,stop,hasPending}AssistantVoice` in PR-5b so:
 *
 *   - the stats accounting + progress logging is testable without electron
 *     or a live TV (constructor takes ports for transport / clock / logger);
 *   - `GoogleTvAdapter` shrinks toward being a thin orchestrator;
 *   - future Apple TV / Roku voice integrations have a single seam to plug
 *     into instead of cluttering the per-device adapter.
 *
 * The service deliberately does NOT know about `SavedDevice` or `host`.
 * The caller passes a `VoiceSessionTarget` per call; the service decides
 * everything else (session id ownership, stats lifecycle, log cadence).
 *
 * PR-QW-adopt-logger (Wave 9): the previously-local `IVoiceLogger` and
 * `IClock` interfaces are replaced by the shared `ILogger` (PR-QW-logger)
 * and `IClock` (PR-QW-clock) ports. Removes 2 duplicate interface
 * declarations and lets callers pass `silentLogger` /
 * `createInMemoryLogger()` directly without an adapter.
 */
import type { IClock } from '../core/clock';
import type { ILogger } from '../core/logger';

export interface VoiceSessionTarget {
  /** Stable id of the device the caller has resolved (used in log details). */
  deviceId: string;
  /** Network host of the device. */
  host: string;
  /** Optional MAC, used by the transport to disambiguate cert keys. */
  macAddress?: string;
}

/**
 * The "lower half" of the voice session — the four operations performed
 * against a connected transport. In production this is implemented by
 * `androidTvRemoteBridge`; in tests by an in-memory fake.
 */
export interface IVoiceTransport {
  start(host: string, macAddress?: string): Promise<number>;
  sendChunk(host: string, sessionId: number, chunk: Buffer, macAddress?: string): Promise<void>;
  stop(host: string, sessionId: number, macAddress?: string): Promise<void>;
  hasPending(host: string, macAddress?: string): Promise<boolean>;
}

interface SessionStats {
  chunks: number;
  bytes: number;
  startedAt: number;
}

/** Log a progress entry every N chunks. Matches the cadence the previous
 * inline code used (every 10 chunks) so log output is unchanged. */
export const VOICE_PROGRESS_LOG_EVERY_N_CHUNKS = 10;

export class VoiceSessionService {
  private readonly stats = new Map<number, SessionStats>();

  constructor(
    private readonly transport: IVoiceTransport,
    private readonly clock: IClock,
    private readonly logger: ILogger
  ) {}

  /** Begin a voice session for the given device. Returns the transport's
   * session id, which the caller must echo back on chunk / stop. */
  async start(target: VoiceSessionTarget): Promise<number> {
    const sessionId = await this.transport.start(target.host, target.macAddress);
    // PR-QW-adopt-logger: ILogger is synchronous-by-contract — no await.
    this.logger.info('adapter', 'Assistant voice session started', {
      deviceId: target.deviceId,
      host: target.host,
      sessionId,
    });
    this.stats.set(sessionId, { chunks: 0, bytes: 0, startedAt: this.clock.now() });
    return sessionId;
  }

  /**
   * Decode `chunkBase64` and forward it to the transport. Updates per-session
   * counters and emits a progress log line every N chunks.
   *
   * If a chunk arrives for an unknown session id (because the caller missed
   * the start event or it was already stopped), the chunk is still forwarded
   * — the transport may have its own queueing — but a warning-grade log line
   * is emitted so the orphan is visible.
   */
  async sendChunk(
    target: VoiceSessionTarget,
    sessionId: number,
    chunkBase64: string
  ): Promise<void> {
    const chunk = Buffer.from(chunkBase64, 'base64');
    await this.transport.sendChunk(target.host, sessionId, chunk, target.macAddress);

    const stats = this.stats.get(sessionId);
    if (stats) {
      stats.chunks += 1;
      stats.bytes += chunk.length;
      if (stats.chunks % VOICE_PROGRESS_LOG_EVERY_N_CHUNKS === 0) {
        this.logger.info('adapter', 'Assistant voice chunk progress', {
          deviceId: target.deviceId,
          host: target.host,
          sessionId,
          chunks: stats.chunks,
          bytes: stats.bytes,
        });
      }
    } else {
      this.logger.info('adapter', 'Assistant voice chunk sent without tracked session', {
        deviceId: target.deviceId,
        host: target.host,
        sessionId,
        bytes: chunk.length,
      });
    }
  }

  /** Stop the session and emit a summary log line (chunks / bytes / duration). */
  async stop(target: VoiceSessionTarget, sessionId: number): Promise<void> {
    await this.transport.stop(target.host, sessionId, target.macAddress);
    const stats = this.stats.get(sessionId);
    this.stats.delete(sessionId);
    this.logger.info('adapter', 'Assistant voice session ended', {
      deviceId: target.deviceId,
      host: target.host,
      sessionId,
      chunks: stats?.chunks ?? 0,
      bytes: stats?.bytes ?? 0,
      durationMs: stats ? this.clock.now() - stats.startedAt : undefined,
    });
  }

  /** Whether the transport reports any pending session for the target. */
  async hasPending(target: VoiceSessionTarget): Promise<boolean> {
    return this.transport.hasPending(target.host, target.macAddress);
  }

  /** TEST-ONLY: peek tracked sessions. */
  _trackedSessions(): readonly number[] {
    return Array.from(this.stats.keys());
  }
}
