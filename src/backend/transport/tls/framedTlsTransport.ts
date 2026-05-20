/**
 * IFramedTlsTransport — thin port over the write+drain side of a TLS socket
 * carrying Android TV varint-prefixed frames.
 *
 * PR-3d (Wave 8) introduces this port behind the same seam-first pattern
 * PR-3c established for `ITlsConnector`. The 9 `socket.write(...)` sites
 * scattered through `NativeRemoteClient` collapse to `transport.send(...)`,
 * and the inline `socket.once('drain', ...)` block in `sendCommand` becomes
 * `transport.onDrain(cb)`.
 *
 * What's deliberately NOT in this port (yet):
 *   - Inbound data routing (`onData`) — still owned directly by
 *     `NativeRemoteClient.flushBuffer` so this PR has zero risk to the
 *     parseFramedBuffer hot path (gated by PR-3b's 13 tests).
 *   - Socket-level event listeners (`once('remote-voice-begin')`) — those
 *     are protocol-state plumbing on top of the parsed inbound stream, not
 *     transport. Future PR-3e moves the inbound surface; PR-3f moves the
 *     full lifecycle (connect / disconnect / close).
 *
 * Production: `createFramedTlsTransportOverSocket(socket)` wraps a live
 * `TLSSocket` (acquired via `ITlsConnector` from PR-3c).
 *
 * Tests: a hand-rolled `FakeFramedTlsTransport` or the test factory at
 * the bottom of this file (`createFakeFramedTlsTransport()`) drives
 * `send`/`onDrain`/`destroyed` deterministically with no real socket.
 */

import type { TLSSocket } from 'node:tls';

/**
 * The transport surface used by `NativeRemoteClient` for outbound writes
 * AND inbound data dispatch.
 *
 * Intentionally minimal — only what the writer and the inbound dispatch
 * loop need. Other socket-level concerns (close / error / timeout /
 * protocol-level events like `remote-voice-begin`) stay on the raw socket
 * until PR-3f.
 */
export interface IFramedTlsTransport {
  /**
   * Write a single complete frame to the underlying TLS socket.
   *
   * Returns `true` if the bytes drained to the kernel immediately, `false`
   * if they were buffered in userland (in which case the caller may want to
   * `onDrain(...)` to know when the buffer empties — the metrics store
   * uses this to log backpressure events).
   *
   * Throws `Error('Transport is closed')` if the underlying socket was
   * destroyed since the transport was constructed.
   */
  send(frame: Buffer): boolean;

  /**
   * Subscribe to the next `'drain'` event from the underlying socket. The
   * handler is invoked once and removed. Returns an unsubscribe function in
   * case the caller wants to cancel the subscription before drain fires.
   *
   * Matching `socket.once('drain', cb)` semantics exactly so the
   * existing call site in `NativeRemoteClient.sendCommand` is a 1:1 swap.
   */
  onDrain(handler: () => void): () => void;

  /**
   * Subscribe to inbound chunks from the underlying socket. The handler is
   * invoked once per `'data'` event with the chunk normalised to a `Buffer`
   * (Node's socket.on('data') yields `Buffer | string`; we always pass a
   * Buffer so the caller never has to handle the union).
   *
   * Returns an unsubscribe function. Production socket-side cleanup is
   * still the caller's responsibility (this PR doesn't take ownership of
   * `socket.removeAllListeners`).
   *
   * PR-3e introduced this method to complete the inbound side of the
   * transport contract. Combined with PR-3b's `parseFramedBuffer`, the
   * entire write-and-parse loop is now testable without a real TLS socket.
   */
  onData(handler: (chunk: Buffer) => void): () => void;

  /**
   * Subscribe to fatal socket errors. Mirrors `socket.on('error', cb)` —
   * fires zero or more times before close. Returns an unsubscribe.
   * PR-3f completion of the lifecycle side of the transport contract.
   */
  onError(handler: (error: Error) => void): () => void;

  /**
   * Subscribe to socket close events. Fires exactly once after the socket
   * is destroyed (whether by remote disconnect, fatal error, or local
   * `disconnect()`). Returns an unsubscribe.
   */
  onClose(handler: () => void): () => void;

  /**
   * Subscribe to socket timeout events. The underlying socket's idle
   * timeout was configured via `socket.setTimeout(ms)` before this
   * transport was created — the transport intentionally does NOT own
   * timeout configuration since the value depends on the caller's
   * protocol (e.g. REMOTE_CONNECT_TIMEOUT_MS for the connect handshake).
   * Returns an unsubscribe.
   */
  onTimeout(handler: () => void): () => void;

  /** Mirrors `socket.destroyed`. Used by `NativeRemoteClient.isConnected`. */
  readonly destroyed: boolean;
}

/**
 * Production binding — wraps a live TLSSocket. The transport doesn't own
 * the socket's lifecycle: the caller is still responsible for `destroy()`,
 * `connect`, listener wiring beyond drain, etc. PR-3e/PR-3f will lift
 * those concerns into the transport when they're ready to be tested
 * deterministically.
 */
export function createFramedTlsTransportOverSocket(socket: TLSSocket): IFramedTlsTransport {
  return {
    send(frame) {
      if (socket.destroyed) {
        throw new Error('Transport is closed');
      }
      return socket.write(frame);
    },
    onDrain(handler) {
      socket.once('drain', handler);
      return () => {
        socket.removeListener('drain', handler);
      };
    },
    onData(handler) {
      // PR-3e: normalise Buffer|string union from socket.on('data') so
      // every NativeRemoteClient inbound handler sees a Buffer regardless
      // of the socket's encoding setting.
      const listener = (chunk: Buffer | string): void => {
        handler(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      };
      socket.on('data', listener);
      return () => {
        socket.removeListener('data', listener);
      };
    },
    onError(handler) {
      socket.on('error', handler);
      return () => {
        socket.removeListener('error', handler);
      };
    },
    onClose(handler) {
      socket.on('close', handler);
      return () => {
        socket.removeListener('close', handler);
      };
    },
    onTimeout(handler) {
      socket.on('timeout', handler);
      return () => {
        socket.removeListener('timeout', handler);
      };
    },
    get destroyed() {
      return socket.destroyed;
    },
  };
}

/**
 * Test factory — deterministic in-memory transport. Tests inspect `writes`,
 * call `emitDrain()` to fire pending drain subscribers, and toggle
 * `destroyed` to simulate socket close.
 *
 * `nextWriteReturns(value)` lets a test drive the synchronous "buffered vs.
 * immediate" return of `send()` without touching real TCP backpressure.
 */
export function createFakeFramedTlsTransport(): IFramedTlsTransport & {
  readonly writes: readonly Buffer[];
  /** Sets the return value of the *next* `send()` call. Defaults to true. */
  nextWriteReturns(value: boolean): void;
  /** Fires all pending drain subscribers once, then clears them. */
  emitDrain(): void;
  /**
   * Deliver `chunk` to every active onData subscriber. Throws if a subscriber
   * handler throws (matches Node's socket.on('data') semantics that one bad
   * listener takes down the dispatch). Tests asserting isolation should
   * subscribe via separate transports.
   */
  emitData(chunk: Buffer): void;
  /** PR-3f: trigger every active onError subscriber with `error`. */
  emitError(error: Error): void;
  /** PR-3f: trigger every active onClose subscriber. */
  emitClose(): void;
  /** PR-3f: trigger every active onTimeout subscriber. */
  emitTimeout(): void;
  /** Mutates `destroyed`. */
  setDestroyed(value: boolean): void;
} {
  const writes: Buffer[] = [];
  let nextReturn: boolean | undefined;
  let isDestroyed = false;
  const drainSubscribers: (() => void)[] = [];
  // PR-3e: data subscribers are an array (not a single field) so the test
  // factory can verify multi-subscriber dispatch the same way the
  // production binding does.
  const dataSubscribers: ((chunk: Buffer) => void)[] = [];
  // PR-3f: lifecycle subscribers.
  const errorSubscribers: ((error: Error) => void)[] = [];
  const closeSubscribers: (() => void)[] = [];
  const timeoutSubscribers: (() => void)[] = [];

  return {
    get writes(): readonly Buffer[] {
      return writes;
    },
    nextWriteReturns(value) {
      nextReturn = value;
    },
    emitDrain() {
      const pending = drainSubscribers.splice(0);
      for (const handler of pending) {
        handler();
      }
    },
    emitData(chunk) {
      for (const handler of dataSubscribers.slice()) {
        handler(chunk);
      }
    },
    emitError(error) {
      for (const handler of errorSubscribers.slice()) {
        handler(error);
      }
    },
    emitClose() {
      for (const handler of closeSubscribers.slice()) {
        handler();
      }
    },
    emitTimeout() {
      for (const handler of timeoutSubscribers.slice()) {
        handler();
      }
    },
    setDestroyed(value) {
      isDestroyed = value;
    },
    send(frame) {
      if (isDestroyed) {
        throw new Error('Transport is closed');
      }
      writes.push(frame);
      const result = nextReturn ?? true;
      nextReturn = undefined;
      return result;
    },
    onDrain(handler) {
      drainSubscribers.push(handler);
      return () => {
        const index = drainSubscribers.indexOf(handler);
        if (index >= 0) {
          drainSubscribers.splice(index, 1);
        }
      };
    },
    onData(handler) {
      dataSubscribers.push(handler);
      return () => {
        const index = dataSubscribers.indexOf(handler);
        if (index >= 0) {
          dataSubscribers.splice(index, 1);
        }
      };
    },
    onError(handler) {
      errorSubscribers.push(handler);
      return () => {
        const index = errorSubscribers.indexOf(handler);
        if (index >= 0) {
          errorSubscribers.splice(index, 1);
        }
      };
    },
    onClose(handler) {
      closeSubscribers.push(handler);
      return () => {
        const index = closeSubscribers.indexOf(handler);
        if (index >= 0) {
          closeSubscribers.splice(index, 1);
        }
      };
    },
    onTimeout(handler) {
      timeoutSubscribers.push(handler);
      return () => {
        const index = timeoutSubscribers.indexOf(handler);
        if (index >= 0) {
          timeoutSubscribers.splice(index, 1);
        }
      };
    },
    get destroyed() {
      return isDestroyed;
    },
  };
}
