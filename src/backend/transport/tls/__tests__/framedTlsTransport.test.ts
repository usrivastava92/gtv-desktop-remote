import { describe, expect, it, vi } from 'vitest';

import {
  createFakeFramedTlsTransport,
  createFramedTlsTransportOverSocket,
  type IFramedTlsTransport,
} from '../framedTlsTransport';

/**
 * PR-3d tests for the IFramedTlsTransport port. Two halves:
 *   1. Contract tests for the production binding using a minimal fake socket.
 *   2. Behaviour tests for the in-memory test factory itself, since other
 *      tests in the suite will rely on it to exercise NativeRemoteClient.
 */

interface FakeSocket {
  destroyed: boolean;
  written: Buffer[];
  writeReturnValue: boolean;
  drainHandlers: (() => void)[];
}

/**
 * Constructs a TLSSocket-shaped object minimal enough to satisfy
 * `createFramedTlsTransportOverSocket`. Exposes a few extra hooks tests
 * use to simulate socket-side events.
 */
function makeFakeSocket(): FakeSocket & {
  write(buffer: Buffer): boolean;
  once(event: string, handler: () => void): unknown;
  removeListener(event: string, handler: () => void): unknown;
  fireDrain(): void;
} {
  const state: FakeSocket = {
    destroyed: false,
    written: [],
    writeReturnValue: true,
    drainHandlers: [],
  };
  return {
    ...state,
    get destroyed() {
      return state.destroyed;
    },
    set destroyed(value: boolean) {
      state.destroyed = value;
    },
    get written() {
      return state.written;
    },
    get drainHandlers() {
      return state.drainHandlers;
    },
    get writeReturnValue() {
      return state.writeReturnValue;
    },
    set writeReturnValue(value: boolean) {
      state.writeReturnValue = value;
    },
    write(buffer: Buffer): boolean {
      state.written.push(buffer);
      return state.writeReturnValue;
    },
    once(event: string, handler: () => void) {
      if (event === 'drain') {
        state.drainHandlers.push(handler);
      }
      return this;
    },
    removeListener(event: string, handler: () => void) {
      if (event === 'drain') {
        const idx = state.drainHandlers.indexOf(handler);
        if (idx >= 0) {
          state.drainHandlers.splice(idx, 1);
        }
      }
      return this;
    },
    fireDrain() {
      const pending = state.drainHandlers.splice(0);
      for (const h of pending) h();
    },
  };
}

describe('IFramedTlsTransport — production binding over socket', () => {
  it('send() forwards the buffer to socket.write and returns its result', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    socket.writeReturnValue = true;
    const result = transport.send(Buffer.from([1, 2, 3]));
    expect(result).toBe(true);
    expect(socket.written).toHaveLength(1);
    expect(socket.written[0]?.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('send() returns false when socket.write reports buffered (backpressure)', () => {
    const socket = makeFakeSocket();
    socket.writeReturnValue = false;
    const transport = createFramedTlsTransportOverSocket(socket as never);
    expect(transport.send(Buffer.from([9]))).toBe(false);
  });

  it('send() throws when the socket is already destroyed', () => {
    const socket = makeFakeSocket();
    socket.destroyed = true;
    const transport = createFramedTlsTransportOverSocket(socket as never);
    expect(() => transport.send(Buffer.from([1]))).toThrow(/closed/i);
  });

  it('destroyed mirrors socket.destroyed', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    expect(transport.destroyed).toBe(false);
    socket.destroyed = true;
    expect(transport.destroyed).toBe(true);
  });

  it('onDrain subscribes via socket.once and fires when drain arrives', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    const handler = vi.fn();
    transport.onDrain(handler);
    expect(socket.drainHandlers).toHaveLength(1);
    socket.fireDrain();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(socket.drainHandlers).toHaveLength(0);
  });

  it('onDrain returns an unsubscribe that removes the listener', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    const handler = vi.fn();
    const unsubscribe = transport.onDrain(handler);
    unsubscribe();
    expect(socket.drainHandlers).toHaveLength(0);
    socket.fireDrain();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('IFramedTlsTransport — createFakeFramedTlsTransport', () => {
  it('writes are captured in call order', () => {
    const t = createFakeFramedTlsTransport();
    t.send(Buffer.from([1]));
    t.send(Buffer.from([2, 3]));
    expect(t.writes).toHaveLength(2);
    expect(t.writes[0]?.[0]).toBe(1);
    expect(t.writes[1]?.[1]).toBe(3);
  });

  it('send defaults to returning true', () => {
    const t = createFakeFramedTlsTransport();
    expect(t.send(Buffer.from([1]))).toBe(true);
  });

  it('nextWriteReturns(false) makes exactly one write return false', () => {
    const t = createFakeFramedTlsTransport();
    t.nextWriteReturns(false);
    expect(t.send(Buffer.from([1]))).toBe(false);
    expect(t.send(Buffer.from([2]))).toBe(true); // back to default
  });

  it('emitDrain fires all pending subscribers exactly once', () => {
    const t = createFakeFramedTlsTransport();
    const a = vi.fn();
    const b = vi.fn();
    t.onDrain(a);
    t.onDrain(b);
    t.emitDrain();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    t.emitDrain();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe before drain prevents the handler from firing', () => {
    const t = createFakeFramedTlsTransport();
    const a = vi.fn();
    const unsubscribe = t.onDrain(a);
    unsubscribe();
    t.emitDrain();
    expect(a).not.toHaveBeenCalled();
  });

  it('setDestroyed(true) makes subsequent send() throw', () => {
    const t = createFakeFramedTlsTransport();
    t.setDestroyed(true);
    expect(t.destroyed).toBe(true);
    expect(() => t.send(Buffer.from([1]))).toThrow(/closed/i);
  });

  it('satisfies the IFramedTlsTransport interface (compile-time gate)', () => {
    const t: IFramedTlsTransport = createFakeFramedTlsTransport();
    expect(t.destroyed).toBe(false);
  });
});
