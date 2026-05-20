/**
 * `ITlsConnector` is the seam between `NativeRemoteClient` and Node's `tls`
 * module. Production wires it to `tls.connect(options)`; tests inject a fake
 * that returns a `FakeTlsSocket` driving framing / drain / close events
 * deterministically.
 *
 * Extracted in PR-3c. The actual TLS lifecycle inside `androidTvRemote.ts`
 * (the 75-line connect/secureConnect/data/close/timeout block) keeps doing
 * its thing — this PR only abstracts the **socket factory**. Follow-up
 * PR-3d will move the lifecycle wiring itself, behind a higher-level
 * `IFramedTlsTransport` interface that owns reconnect + drain + backpressure.
 *
 * Adding a new field to `TlsConnectionOptions`: extend the interface, update
 * the production `NodeTlsConnector` impl, and adjust the call site in
 * `androidTvRemote.ts`. Tests don't need to change unless they assert on
 * the new field.
 */
import type * as NodeTls from 'node:tls';
import type { TLSSocket } from 'node:tls';

/**
 * Options for opening a new TLS connection to a device. Mirrors the subset
 * of Node's `tls.ConnectionOptions` that the Android TV remote protocol
 * actually uses.
 */
export interface TlsConnectionOptions {
  /** Network host of the device. */
  readonly host: string;
  /** Port on the device. Android TV remote v2 uses 6466. */
  readonly port: number;
  /** Client certificate (PEM) presented to the device for mTLS. */
  readonly cert: string;
  /** Private key (PEM) matching `cert`. */
  readonly key: string;
  /**
   * Whether to validate the device's certificate against the system trust
   * store. Android TV self-signs, so production passes `false`. The TV
   * presents the same cert for the entire pairing → command lifecycle, so
   * pinning the fingerprint is the safer long-term option but out of scope
   * for PR-3c.
   */
  readonly rejectUnauthorized: boolean;
}

/**
 * Open a TLS connection with the given options and return the underlying
 * `TLSSocket`. The caller is responsible for wiring `data` / `error` /
 * `close` / `timeout` / `secureConnect` event handlers BEFORE the socket
 * fires them (Node delivers them on the next tick after `tls.connect`, so
 * there is a window).
 *
 * Returning the raw `TLSSocket` keeps the abstraction minimal — the lower
 * half of the TLS lifecycle (event wiring, drain accounting, framing
 * dispatch) stays in `NativeRemoteClient.connect` and will be hoisted
 * incrementally in PR-3d/PR-3e.
 */
export interface ITlsConnector {
  connect(options: TlsConnectionOptions): TLSSocket;
}

/**
 * Production `ITlsConnector` — thin wrapper over Node's `tls.connect`.
 * Imported lazily so the backend layer never has a hard dependency on
 * `node:tls` (matters when the backend bundle is later consumed by browser
 * tests or by a recorded-capture replayer).
 */
export function createNodeTlsConnector(): ITlsConnector {
  return {
    connect(options) {
      // PR-3c: import lazily so the backend bundle can be consumed in
      // environments without `node:tls` (e.g. recorded-capture replayers).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tls = require('node:tls') as typeof NodeTls;
      return tls.connect({
        host: options.host,
        port: options.port,
        cert: options.cert,
        key: options.key,
        rejectUnauthorized: options.rejectUnauthorized,
      });
    },
  };
}
