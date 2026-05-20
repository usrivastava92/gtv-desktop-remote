import { describe, expect, it } from 'vitest';

import {
  createEmptyMetricsCounters,
  createEmptyMetricsSnapshot,
  createSilentMetricsRecorder,
  type IMetricsRecorder,
} from '../IMetricsRecorder';

describe('createEmptyMetricsCounters', () => {
  it('all counters start at zero', () => {
    const counters = createEmptyMetricsCounters();
    for (const value of Object.values(counters)) {
      expect(value).toBe(0);
    }
  });

  it('returns fresh objects (no shared mutable state)', () => {
    const a = createEmptyMetricsCounters();
    const b = createEmptyMetricsCounters();
    a.totalSubmitted = 99;
    expect(b.totalSubmitted).toBe(0);
  });
});

describe('createEmptyMetricsSnapshot', () => {
  it('zero counters + empty arrays + disconnected transport', () => {
    const snap = createEmptyMetricsSnapshot();
    expect(snap.recentCommands).toEqual([]);
    expect(snap.warnings).toEqual([]);
    expect(snap.counters.totalSubmitted).toBe(0);
    expect(snap.transport.socketState).toBe('disconnected');
    expect(snap.transport.consecutiveSendFailures).toBe(0);
    expect(snap.transport.backpressureEvents).toBe(0);
    expect(snap.generatedAt).toBe(0);
  });
});

describe('createSilentMetricsRecorder', () => {
  const recorder: IMetricsRecorder = createSilentMetricsRecorder();

  it('every recorder method is a no-op that throws nothing', () => {
    expect(() => {
      recorder.recordCommandSucceeded('x');
      recorder.recordConnectFailed('h', 'x', 'boom');
      recorder.recordInboundMessage('h');
      recorder.recordSocketClosed('h');
    }).not.toThrow();
  });

  it('getSnapshot returns an empty snapshot identical to createEmptyMetricsSnapshot', () => {
    expect(recorder.getSnapshot()).toEqual(createEmptyMetricsSnapshot());
  });

  it('returns a *new* snapshot each call (no shared mutable state)', () => {
    const first = recorder.getSnapshot();
    const second = recorder.getSnapshot();
    expect(first).not.toBe(second);
    expect(first.counters).not.toBe(second.counters);
  });
});
