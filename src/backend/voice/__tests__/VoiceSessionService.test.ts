import { describe, expect, it } from 'vitest';

import type { IClock } from '../../core/clock';
import type { ILogger } from '../../core/logger';
import {
  VOICE_PROGRESS_LOG_EVERY_N_CHUNKS,
  VoiceSessionService,
  type IVoiceTransport,
  type VoiceSessionTarget,
} from '../VoiceSessionService';

const TARGET: VoiceSessionTarget = {
  deviceId: 'dev-1',
  host: '192.168.1.42',
  macAddress: 'aa:bb:cc:dd:ee:ff',
};

interface TransportCall {
  op: 'start' | 'sendChunk' | 'stop' | 'hasPending';
  host: string;
  sessionId?: number;
  chunkLength?: number;
  macAddress?: string;
}

interface LogEntry {
  scope: string;
  message: string;
  details?: Record<string, unknown>;
}

function makeFakes(opts: { startSessionId?: number; pending?: boolean } = {}) {
  const transportCalls: TransportCall[] = [];
  const logs: LogEntry[] = [];
  let timeNow = 1_000_000;

  const transport: IVoiceTransport = {
    start: (host, macAddress) => {
      transportCalls.push({ op: 'start', host, macAddress });
      return Promise.resolve(opts.startSessionId ?? 42);
    },
    sendChunk: (host, sessionId, chunk, macAddress) => {
      transportCalls.push({
        op: 'sendChunk',
        host,
        sessionId,
        chunkLength: chunk.length,
        macAddress,
      });
      return Promise.resolve();
    },
    stop: (host, sessionId, macAddress) => {
      transportCalls.push({ op: 'stop', host, sessionId, macAddress });
      return Promise.resolve();
    },
    hasPending: (host, macAddress) => {
      transportCalls.push({ op: 'hasPending', host, macAddress });
      return Promise.resolve(opts.pending ?? false);
    },
  };

  const clock: IClock = {
    now: () => timeNow,
    nowDate: () => new Date(timeNow),
  };

  const logger: ILogger = {
    info: (scope, message, details) => {
      logs.push({ scope, message, details: details as Record<string, unknown> | undefined });
    },
    warn: () => {
      /* unused */
    },
    error: () => {
      /* unused */
    },
  };

  return {
    transport,
    clock,
    logger,
    transportCalls,
    logs,
    advanceClock(ms: number) {
      timeNow += ms;
    },
  };
}

describe('VoiceSessionService.start', () => {
  it('returns the transport session id and logs start', async () => {
    const fakes = makeFakes({ startSessionId: 7 });
    const svc = new VoiceSessionService(fakes.transport, fakes.clock, fakes.logger);

    const id = await svc.start(TARGET);
    expect(id).toBe(7);
    expect(fakes.transportCalls).toEqual([
      { op: 'start', host: TARGET.host, macAddress: TARGET.macAddress },
    ]);
    expect(fakes.logs[0]).toMatchObject({
      scope: 'adapter',
      message: 'Assistant voice session started',
      details: { deviceId: TARGET.deviceId, host: TARGET.host, sessionId: 7 },
    });
    expect(svc._trackedSessions()).toEqual([7]);
  });
});

describe('VoiceSessionService.sendChunk', () => {
  it('forwards the decoded chunk and increments stats', async () => {
    const fakes = makeFakes();
    const svc = new VoiceSessionService(fakes.transport, fakes.clock, fakes.logger);
    const id = await svc.start(TARGET);
    fakes.logs.length = 0;

    // 'hello' base64 → 5 bytes
    await svc.sendChunk(TARGET, id, Buffer.from('hello').toString('base64'));

    expect(fakes.transportCalls).toContainEqual({
      op: 'sendChunk',
      host: TARGET.host,
      sessionId: id,
      chunkLength: 5,
      macAddress: TARGET.macAddress,
    });
    expect(fakes.logs).toEqual([]); // no progress log at chunk #1
  });

  it(`emits a progress log every ${String(VOICE_PROGRESS_LOG_EVERY_N_CHUNKS)} chunks`, async () => {
    const fakes = makeFakes();
    const svc = new VoiceSessionService(fakes.transport, fakes.clock, fakes.logger);
    const id = await svc.start(TARGET);
    fakes.logs.length = 0;

    const oneChunk = Buffer.from('xx').toString('base64'); // 2 bytes
    for (let i = 0; i < VOICE_PROGRESS_LOG_EVERY_N_CHUNKS; i += 1) {
      await svc.sendChunk(TARGET, id, oneChunk);
    }
    expect(fakes.logs).toHaveLength(1);
    expect(fakes.logs[0]).toMatchObject({
      message: 'Assistant voice chunk progress',
      details: {
        sessionId: id,
        chunks: VOICE_PROGRESS_LOG_EVERY_N_CHUNKS,
        bytes: 2 * VOICE_PROGRESS_LOG_EVERY_N_CHUNKS,
      },
    });
  });

  it('logs a warning when a chunk arrives for an untracked session', async () => {
    const fakes = makeFakes();
    const svc = new VoiceSessionService(fakes.transport, fakes.clock, fakes.logger);

    await svc.sendChunk(TARGET, 999, Buffer.from('xy').toString('base64'));

    expect(fakes.logs[0]).toMatchObject({
      message: 'Assistant voice chunk sent without tracked session',
      details: { sessionId: 999, bytes: 2 },
    });
  });
});

describe('VoiceSessionService.stop', () => {
  it('reports chunks / bytes / durationMs in the summary log', async () => {
    const fakes = makeFakes();
    const svc = new VoiceSessionService(fakes.transport, fakes.clock, fakes.logger);
    const id = await svc.start(TARGET);

    await svc.sendChunk(TARGET, id, Buffer.from('aaaa').toString('base64'));
    await svc.sendChunk(TARGET, id, Buffer.from('bb').toString('base64'));
    fakes.logs.length = 0;
    fakes.advanceClock(1_234);

    await svc.stop(TARGET, id);

    expect(fakes.logs[0]).toMatchObject({
      message: 'Assistant voice session ended',
      details: { sessionId: id, chunks: 2, bytes: 6, durationMs: 1_234 },
    });
    expect(svc._trackedSessions()).toEqual([]);
  });

  it('still emits a summary log when stopping an untracked session', async () => {
    const fakes = makeFakes();
    const svc = new VoiceSessionService(fakes.transport, fakes.clock, fakes.logger);

    await svc.stop(TARGET, 999);

    expect(fakes.logs[0]).toMatchObject({
      message: 'Assistant voice session ended',
      details: { sessionId: 999, chunks: 0, bytes: 0, durationMs: undefined },
    });
  });
});

describe('VoiceSessionService.hasPending', () => {
  it('forwards to the transport and returns the result', async () => {
    const fakes = makeFakes({ pending: true });
    const svc = new VoiceSessionService(fakes.transport, fakes.clock, fakes.logger);

    await expect(svc.hasPending(TARGET)).resolves.toBe(true);
    expect(fakes.transportCalls).toContainEqual({
      op: 'hasPending',
      host: TARGET.host,
      macAddress: TARGET.macAddress,
    });
  });
});

describe('VoiceSessionService — multiple concurrent sessions', () => {
  it('tracks stats per-sessionId independently', async () => {
    const fakes = makeFakes();
    const transport = fakes.transport;
    let next = 100;
    transport.start = (host, macAddress) => {
      fakes.transportCalls.push({ op: 'start', host, macAddress });
      next += 1;
      return Promise.resolve(next);
    };

    const svc = new VoiceSessionService(transport, fakes.clock, fakes.logger);
    const idA = await svc.start(TARGET);
    const idB = await svc.start(TARGET);
    expect(idA).not.toBe(idB);

    await svc.sendChunk(TARGET, idA, Buffer.from('x').toString('base64'));
    await svc.sendChunk(TARGET, idB, Buffer.from('yy').toString('base64'));
    await svc.sendChunk(TARGET, idB, Buffer.from('zzz').toString('base64'));

    await svc.stop(TARGET, idA);
    const stopA = fakes.logs.at(-1);
    expect(stopA?.details).toMatchObject({ sessionId: idA, chunks: 1, bytes: 1 });

    await svc.stop(TARGET, idB);
    const stopB = fakes.logs.at(-1);
    expect(stopB?.details).toMatchObject({ sessionId: idB, chunks: 2, bytes: 5 });
  });
});
