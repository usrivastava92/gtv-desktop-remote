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
 * The transport surface used by `NativeRemoteClient` for outbound writes.
 * Intentionally minimal — only the three things the writer cares about.
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
  /** Mutates `destroyed`. */
  setDestroyed(value: boolean): void;
} {
  const writes: Buffer[] = [];
  let nextReturn: boolean | undefined;
  let isDestroyed = false;
  const drainSubscribers: (() => void)[] = [];

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
    get destroyed() {
      return isDestroyed;
    },
  };
}
