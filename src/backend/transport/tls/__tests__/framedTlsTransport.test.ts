import { describe, expect, it, vi } from 'vitest';

import {
  createFakeFramedTlsTransport,
  createFramedTlsTransportOverSocket,
  type IFramedTlsTransport,
} from '../framedTlsTransport';

/**
 * tests for the IFramedTlsTransport port. Two halves:
 *   1. Contract tests for the production binding using a minimal fake socket.
 *   2. Behaviour tests for the in-memory test factory itself, since other
 *      tests in the suite will rely on it to exercise NativeRemoteClient.
 */

interface FakeSocket {
  destroyed: boolean;
  written: Buffer[];
  writeReturnValue: boolean;
  drainHandlers: (() => void)[];
  // track data listeners for onData test coverage.
  dataHandlers: ((chunk: Buffer | string) => void)[];
  // track lifecycle listeners.
  errorHandlers: ((error: Error) => void)[];
  closeHandlers: (() => void)[];
  timeoutHandlers: (() => void)[];
}

/**
 * Constructs a TLSSocket-shaped object minimal enough to satisfy
 * `createFramedTlsTransportOverSocket`. Exposes a few extra hooks tests
 * use to simulate socket-side events.
 */
function makeFakeSocket(): FakeSocket & {
  write(buffer: Buffer): boolean;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  once(event: string, handler: () => void): unknown;
  removeListener(event: string, handler: (...args: unknown[]) => void): unknown;
  fireDrain(): void;
  fireData(chunk: Buffer | string): void;
  fireError(error: Error): void;
  fireClose(): void;
  fireTimeout(): void;
} {
  const state: FakeSocket = {
    destroyed: false,
    written: [],
    writeReturnValue: true,
    drainHandlers: [],
    dataHandlers: [],
    errorHandlers: [],
    closeHandlers: [],
    timeoutHandlers: [],
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
    get dataHandlers() {
      return state.dataHandlers;
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
    on(event: string, handler: (...args: unknown[]) => void) {
      switch (event) {
        case 'data':
          state.dataHandlers.push(handler);
          break;
        case 'error':
          state.errorHandlers.push(handler);
          break;
        case 'close':
          state.closeHandlers.push(handler);
          break;
        case 'timeout':
          state.timeoutHandlers.push(handler);
          break;
      }
      return this;
    },
    once(event: string, handler: () => void) {
      if (event === 'drain') {
        state.drainHandlers.push(handler);
      }
      return this;
    },
    removeListener(event: string, handler: (...args: unknown[]) => void) {
      const map: Record<
        string,
        { indexOf(h: unknown): number; splice(i: number, n: number): void }
      > = {
        drain: state.drainHandlers,
        data: state.dataHandlers,
        error: state.errorHandlers,
        close: state.closeHandlers,
        timeout: state.timeoutHandlers,
      };
      const target = map[event];
      if (target) {
        const idx = target.indexOf(handler);
        if (idx >= 0) {
          target.splice(idx, 1);
        }
      }
      return this;
    },
    fireDrain() {
      const pending = state.drainHandlers.splice(0);
      for (const h of pending) h();
    },
    fireData(chunk: Buffer | string) {
      for (const h of state.dataHandlers.slice()) {
        h(chunk);
      }
    },
    fireError(error: Error) {
      for (const h of state.errorHandlers.slice()) {
        h(error);
      }
    },
    fireClose() {
      for (const h of state.closeHandlers.slice()) {
        h();
      }
    },
    fireTimeout() {
      for (const h of state.timeoutHandlers.slice()) {
        h();
      }
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

  it('onData subscribes via socket.on(data) and dispatches chunks as Buffer', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    const handler = vi.fn();
    transport.onData(handler);
    expect(socket.dataHandlers).toHaveLength(1);
    socket.fireData(Buffer.from([1, 2, 3]));
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0]?.[0] as Buffer).equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('onData normalises string chunks to Buffer (encoding-set sockets)', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    const handler = vi.fn();
    transport.onData(handler);
    socket.fireData('hi');
    expect((handler.mock.calls[0]?.[0] as Buffer).toString('utf8')).toBe('hi');
  });

  it('onData unsubscribe removes the listener and stops future dispatches', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    const handler = vi.fn();
    const unsubscribe = transport.onData(handler);
    unsubscribe();
    expect(socket.dataHandlers).toHaveLength(0);
    socket.fireData(Buffer.from([1]));
    expect(handler).not.toHaveBeenCalled();
  });

  it('onError subscribes via socket.on(error) and dispatches the error', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    const handler = vi.fn();
    transport.onError(handler);
    expect(socket.errorHandlers).toHaveLength(1);
    socket.fireError(new Error('boom'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0]?.[0] as Error).message).toBe('boom');
  });

  it('onClose subscribes via socket.on(close) and dispatches with no payload', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    const handler = vi.fn();
    transport.onClose(handler);
    expect(socket.closeHandlers).toHaveLength(1);
    socket.fireClose();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('onTimeout subscribes via socket.on(timeout) and dispatches with no payload', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    const handler = vi.fn();
    transport.onTimeout(handler);
    expect(socket.timeoutHandlers).toHaveLength(1);
    socket.fireTimeout();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lifecycle unsubscribes remove their respective listeners', () => {
    const socket = makeFakeSocket();
    const transport = createFramedTlsTransportOverSocket(socket as never);
    const errH = vi.fn();
    const closeH = vi.fn();
    const timeoutH = vi.fn();
    const unErr = transport.onError(errH);
    const unClose = transport.onClose(closeH);
    const unTime = transport.onTimeout(timeoutH);
    unErr();
    unClose();
    unTime();
    expect(socket.errorHandlers).toHaveLength(0);
    expect(socket.closeHandlers).toHaveLength(0);
    expect(socket.timeoutHandlers).toHaveLength(0);
    socket.fireError(new Error('x'));
    socket.fireClose();
    socket.fireTimeout();
    expect(errH).not.toHaveBeenCalled();
    expect(closeH).not.toHaveBeenCalled();
    expect(timeoutH).not.toHaveBeenCalled();
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

  it('emitData delivers chunks to onData subscribers in subscription order', () => {
    const t = createFakeFramedTlsTransport();
    const a = vi.fn();
    const b = vi.fn();
    t.onData(a);
    t.onData(b);
    t.emitData(Buffer.from([7]));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect((a.mock.calls[0]?.[0] as Buffer).equals(Buffer.from([7]))).toBe(true);
  });

  it('onData unsubscribe stops future emitData dispatch', () => {
    const t = createFakeFramedTlsTransport();
    const a = vi.fn();
    const unsubscribe = t.onData(a);
    unsubscribe();
    t.emitData(Buffer.from([1]));
    expect(a).not.toHaveBeenCalled();
  });

  it('emitData with no subscribers is a no-op (no throw)', () => {
    const t = createFakeFramedTlsTransport();
    expect(() => {
      t.emitData(Buffer.from([0xff]));
    }).not.toThrow();
  });

  it('emitError/emitClose/emitTimeout dispatch to their respective subscribers', () => {
    const t = createFakeFramedTlsTransport();
    const errH = vi.fn();
    const closeH = vi.fn();
    const timeoutH = vi.fn();
    t.onError(errH);
    t.onClose(closeH);
    t.onTimeout(timeoutH);
    t.emitError(new Error('boom'));
    t.emitClose();
    t.emitTimeout();
    expect(errH).toHaveBeenCalledWith(new Error('boom'));
    expect(closeH).toHaveBeenCalledTimes(1);
    expect(timeoutH).toHaveBeenCalledTimes(1);
  });

  it('lifecycle unsubscribes stop further fake dispatches', () => {
    const t = createFakeFramedTlsTransport();
    const errH = vi.fn();
    const closeH = vi.fn();
    const timeoutH = vi.fn();
    t.onError(errH)();
    t.onClose(closeH)();
    t.onTimeout(timeoutH)();
    t.emitError(new Error('x'));
    t.emitClose();
    t.emitTimeout();
    expect(errH).not.toHaveBeenCalled();
    expect(closeH).not.toHaveBeenCalled();
    expect(timeoutH).not.toHaveBeenCalled();
  });
});
