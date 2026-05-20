import type { TLSSocket } from 'node:tls';

import { createNodeFileSystem, type IFileSystem } from '../../backend/core/fileSystem';
import { AndroidTvCertStore } from '../../backend/devices/credentials/androidTvCertStore';
import { parseFramedBuffer } from '../../backend/transport/framing/frameParser';
import {
  createFramedTlsTransportOverSocket,
  type IFramedTlsTransport,
} from '../../backend/transport/tls/framedTlsTransport';
import {
  createNodeTlsConnector,
  type ITlsConnector,
} from '../../backend/transport/tls/tlsConnector';
import type { CommandDispatchRequest } from '../../shared/types';
import { isCaptureEnabled, record, recordBuffer } from '../capture';
import { createNodeLogger, getAppDataPath, logError } from '../logger';
import { commandMetricsStore } from '../metrics';

import {
  DEFAULT_PAIRING_PORT,
  REMOTE_CONNECT_TIMEOUT_MS,
  REMOTE_FEATURES,
  REMOTE_STALE_AFTER_MS,
  REMOTE_VOICE_BEGIN_TIMEOUT_MS,
  SERVICE_NAME,
  isCertificateRejectedError,
  normalizeRemoteError,
  toError,
  type DeviceSession,
  type PairingManagerInstance,
  type RemoteState,
} from './androidTvRemote.types';
import type { PemPair } from './protocol/certificate';
import {
  createImeBatchEditMessage,
  createRemoteConfigure,
  createRemoteKeyInject,
  createRemoteKeyInjectRaw,
  createRemotePingResponse,
  createRemoteSetActive,
  createRemoteVoiceBegin,
  createRemoteVoiceEnd,
  createRemoteVoicePayload,
  parseRemoteMessage,
} from './protocol/remoteProtocol';

const { PairingManager } = require('androidtv-remote/dist/pairing/PairingManager.js') as {
  PairingManager: new (
    host: string,
    port: number,
    certs: PemPair,
    serviceName: string
  ) => PairingManagerInstance;
};

class NativeRemoteClient {
  private socket: TLSSocket | undefined;

  private transport: IFramedTlsTransport | undefined;

  private connectPromise: Promise<void> | undefined;

  private buffer = Buffer.alloc(0);

  private protocolReady = false;

  private state: RemoteState = {
    imeCounter: 0,
    imeFieldCounter: 0,
    lastActivityAt: 0,
  };

  constructor(
    private readonly host: string,
    private readonly certs: PemPair,
    private readonly tlsConnector: ITlsConnector
  ) {}

  get snapshot(): RemoteState {
    return this.state;
  }

  get isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed && this.protocolReady);
  }

  async connect(commandId?: string): Promise<void> {
    const isStale =
      this.socket &&
      !this.socket.destroyed &&
      this.state.lastActivityAt > 0 &&
      Date.now() - this.state.lastActivityAt > REMOTE_STALE_AFTER_MS;

    if (isStale) {
      this.disconnect();
    }

    if (this.isConnected) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (commandId) {
      commandMetricsStore.recordConnectStarted(this.host, commandId);
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = this.tlsConnector.connect({
        cert: this.certs.cert,
        host: this.host,
        key: this.certs.key,
        port: 6466,
        rejectUnauthorized: false,
      });
      let settled = false;

      const fail = (error: unknown) => {
        const normalized = toError(error, `Could not connect to ${this.host}.`);
        if (!settled) {
          settled = true;
          reject(normalized);
        }

        void logError('androidtvremote', 'Remote socket error', normalized);
      };

      socket.setTimeout(REMOTE_CONNECT_TIMEOUT_MS);
      const onSocketTimeout = (): void => {
        socket.destroy(new Error('Remote connection timed out.'));
      };
      const onSecureConnect = (): void => {
        this.state.lastActivityAt = Date.now();
      };
      socket.on('secureConnect', onSecureConnect);
      // inbound data now flows through IFramedTlsTransport.onData.
      const onInboundChunk = (chunk: Buffer): void => {
        commandMetricsStore.recordInboundMessage(this.host);
        this.state.lastActivityAt = Date.now();
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.flushBuffer();
      };
      const onSocketError = (error: Error): void => {
        fail(error);
      };
      const onSocketClose = (): void => {
        commandMetricsStore.recordSocketClosed(this.host);
        this.socket = undefined;
        this.protocolReady = false;
        this.buffer = Buffer.alloc(0);
        if (!settled) {
          settled = true;
          reject(new Error(`Could not connect to ${this.host}.`));
        }
      };

      const finishProtocolHandshake = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();

        if (commandId) {
          commandMetricsStore.recordConnectCompleted(this.host, commandId);
        }
      };

      socket.once('remote-protocol-ready', finishProtocolHandshake);
      this.socket = socket;
      // wrap the live socket in the framed transport port.
      this.transport = createFramedTlsTransportOverSocket(socket);
      // inbound data via transport.onData.
      this.transport.onData(onInboundChunk);
      this.transport.onError(onSocketError);
      this.transport.onClose(onSocketClose);
      this.transport.onTimeout(onSocketTimeout);
    }).finally(() => {
      this.connectPromise = undefined;
    });

    return this.connectPromise.catch((error: unknown) => {
      if (commandId) {
        commandMetricsStore.recordConnectFailed(
          this.host,
          commandId,
          toError(error, `Could not connect to ${this.host}.`).message
        );
      }

      throw error;
    });
  }

  disconnect(): void {
    if (!this.socket) {
      return;
    }

    this.socket.removeAllListeners('close');
    this.socket.destroy();
    commandMetricsStore.recordSocketClosed(this.host);
    this.socket = undefined;
    this.transport = undefined;
    this.protocolReady = false;
    this.buffer = Buffer.alloc(0);
  }

  sendCommand(request: CommandDispatchRequest): void {
    const transport = this.getTransport();
    const frame = createRemoteKeyInject(request.command);
    if (isCaptureEnabled()) {
      recordBuffer('remote', 'tx', 'sendCommand', frame, { command: request.command, id: request.id, host: this.host });
    }
    const wroteImmediately = transport.send(frame);
    commandMetricsStore.recordSocketWrite(request, {
      host: this.host,
      buffered: !wroteImmediately,
    });
    if (!wroteImmediately) {
      transport.onDrain(() => {
        commandMetricsStore.recordSocketDrain(this.host, request.id);
      });
    }
  }

  sendText(text: string): void {
    const value = text.trim();
    if (!value) {
      throw new Error('Text cannot be empty.');
    }

    this.getTransport().send(
      createImeBatchEditMessage(this.state.imeCounter, this.state.imeFieldCounter, value)
    );
  }

  async startVoiceSession(): Promise<number> {
    const socket = this.getSocket();
    const transport = this.getTransport();
    if (this.state.voiceSessionId) {
      const existingSessionId = this.state.voiceSessionId;
      transport.send(createRemoteVoiceBegin(existingSessionId));
      return existingSessionId;
    }

    this.state.voiceSessionId = undefined;
    const waitForVoiceBegin = () =>
      new Promise<number>((resolve, reject) => {
        const onVoiceBegin = (nextSessionId: number) => {
          clearTimeout(timeoutId);
          resolve(nextSessionId);
        };

        const timeoutId = setTimeout(() => {
          socket.removeListener('remote-voice-begin', onVoiceBegin);
          reject(new Error('TV did not open a voice session.'));
        }, REMOTE_VOICE_BEGIN_TIMEOUT_MS);

        socket.once('remote-voice-begin', onVoiceBegin);
      });

    transport.send(createRemoteKeyInjectRaw('KEYCODE_SEARCH', 'START_LONG'));

    let sessionId: number;
    try {
      sessionId = await waitForVoiceBegin();
    } catch (err) {
      transport.send(createRemoteKeyInjectRaw('KEYCODE_SEARCH', 'END_LONG'));
      throw err;
    }

    transport.send(createRemoteVoiceBegin(sessionId));
    return sessionId;
  }

  sendVoiceChunk(sessionId: number, samples: Buffer): void {
    if (!samples.length) {
      return;
    }

    this.getTransport().send(createRemoteVoicePayload(sessionId, samples));
  }

  stopVoiceSession(sessionId: number): void {
    const transport = this.getTransport();
    transport.send(createRemoteVoiceEnd(sessionId));
    transport.send(createRemoteKeyInjectRaw('KEYCODE_SEARCH', 'END_LONG'));
    if (this.state.voiceSessionId === sessionId) {
      this.state.voiceSessionId = undefined;
    }
  }

  private getSocket(): TLSSocket {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Connection has been lost.');
    }

    return this.socket;
  }

  /**
   * like `getSocket()` but returns the framed transport port.
   * Throws the same "Connection has been lost." error so the existing
   * error-handling behavior at call sites stays identical.
   */
  private getTransport(): IFramedTlsTransport {
    if (!this.transport || this.transport.destroyed) {
      throw new Error('Connection has been lost.');
    }

    return this.transport;
  }

  /**
   * framing was a 40-line inline varint parser. It now delegates to
   * the pure `parseFramedBuffer` helper in `src/backend/transport/framing/`,
   * which is unit-tested byte-by-byte (partial reads, multi-frame chunks,
   * malformed varints, streaming windows). Behavior is byte-identical to
   * the previous inline implementation — same malformed-frame error message,
   * same buffer-clear-on-error semantics, same socket destroy on bad input.
   */
  private flushBuffer(): void {
    const result = parseFramedBuffer(this.buffer);
    this.buffer = Buffer.from(result.remaining);

    if (result.error) {
      this.socket?.destroy(result.error);
      // `parseFramedBuffer` already cleared remaining on error; defensive:
      this.buffer = Buffer.alloc(0);
    }

    for (const frame of result.frames) {
      if (isCaptureEnabled()) {
        recordBuffer('transport', 'rx', 'inbound-frame', frame, { host: this.host });
      }
      const message = parseRemoteMessage(frame);
      if (isCaptureEnabled()) {
        record({ layer: 'remote', direction: 'rx', event: 'parsed-message', data: message, meta: { host: this.host } });
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: {
    remoteConfigure?: {
      code1?: number;
      deviceInfo?: { appVersion?: string; model?: string; vendor?: string };
    };
    remoteSetActive?: Record<string, unknown>;
    remotePingRequest?: { val1?: number };
    remoteImeKeyInject?: { appInfo?: { appPackage?: string } };
    remoteImeBatchEdit?: { fieldCounter?: number; imeCounter?: number };
    remoteVoiceBegin?: { sessionId?: number };
    remoteVoiceEnd?: { sessionId?: number };
    remoteStart?: { started?: boolean };
  }): void {
    if (message.remoteConfigure) {
      this.state.deviceInfo = {
        appVersion: message.remoteConfigure.deviceInfo?.appVersion,
        model: message.remoteConfigure.deviceInfo?.model,
        vendor: message.remoteConfigure.deviceInfo?.vendor,
      };
      this.getSocket().write(createRemoteConfigure(REMOTE_FEATURES));
      this.protocolReady = true;
      this.getSocket().emit('remote-protocol-ready');
      return;
    }

    if (message.remoteSetActive) {
      this.getSocket().write(createRemoteSetActive(REMOTE_FEATURES));
      return;
    }

    if (message.remotePingRequest?.val1 !== undefined) {
      this.getSocket().write(createRemotePingResponse(message.remotePingRequest.val1));
      return;
    }

    if (message.remoteImeKeyInject?.appInfo?.appPackage) {
      this.state.currentApp = message.remoteImeKeyInject.appInfo.appPackage;
      return;
    }

    if (message.remoteImeBatchEdit) {
      this.state.imeCounter = message.remoteImeBatchEdit.imeCounter ?? this.state.imeCounter;
      this.state.imeFieldCounter =
        message.remoteImeBatchEdit.fieldCounter ?? this.state.imeFieldCounter;
      return;
    }

    if (message.remoteStart) {
      this.state.isOn = Boolean(message.remoteStart.started);
      return;
    }

    if (message.remoteVoiceBegin?.sessionId) {
      this.state.voiceSessionId = message.remoteVoiceBegin.sessionId;
      this.getSocket().emit('remote-voice-begin', message.remoteVoiceBegin.sessionId);
      return;
    }

    if (message.remoteVoiceEnd) {
      this.state.voiceSessionId = undefined;
    }
  }
}

export class AndroidTvRemoteBridge {
  private readonly sessions = new Map<string, DeviceSession>();
  private readonly fs: IFileSystem = createNodeFileSystem();

  private readonly tlsConnector: ITlsConnector = createNodeTlsConnector();

  private readonly certStore = new AndroidTvCertStore(
    this.fs,
    {
      getCertStateDir: () => getAppDataPath('androidtvremote'),
      getAppDataPath: (...segments) => getAppDataPath(...segments),
    },
    createNodeLogger()
  );

  private getFilesForCertKey(certKey: string): { certPath: string; keyPath: string } {
    return this.certStore.getFilesForCertKey(certKey);
  }

  /** @deprecated Use getFilesForCertKey with a macAddress-based key */
  private getFilesForHost(host: string): { certPath: string; keyPath: string } {
    return this.getFilesForCertKey(host);
  }

  /**
   * Move persisted certs from one identity key to another.
   * Safe to call even if the old file doesn't exist.
   */
  async migratePersistedCerts(oldCertKey: string, newCertKey: string): Promise<void> {
    await this.certStore.migrate(oldCertKey, newCertKey);
  }

  /**
   * Migrate certs from old IP-based filename to MAC-based filename.
   * Safe to call even if the old file doesn't exist.
   */
  async migrateCerts(oldHost: string, macAddress: string): Promise<void> {
    await this.migratePersistedCerts(oldHost, macAddress);
  }

  private async loadOrCreateCerts(certKey: string): Promise<PemPair> {
    return this.certStore.loadOrCreate(certKey);
  }

  private async clearPersistedHostState(certKey: string): Promise<void> {
    await this.certStore.clear(certKey);
  }

  private async clearHostSession(
    host: string,
    removeCerts = false,
    certKey?: string
  ): Promise<void> {
    const normalizedHost = host.trim();
    const session = this.sessions.get(normalizedHost);

    session?.remoteClient?.disconnect();
    this.sessions.delete(normalizedHost);

    if (removeCerts) {
      await this.clearPersistedHostState(certKey ?? normalizedHost);
    }
  }

  private async getSession(host: string, certKey?: string): Promise<DeviceSession> {
    const normalizedHost = host.trim();
    if (!normalizedHost) {
      throw new Error('Missing host');
    }

    const normalizedCertKey = certKey?.trim();
    if (normalizedCertKey && normalizedCertKey !== normalizedHost) {
      await this.migrateCerts(normalizedHost, normalizedCertKey);
    }

    const existing = this.sessions.get(normalizedHost);
    if (existing) {
      return existing;
    }

    const session: DeviceSession = {
      certs: await this.loadOrCreateCerts(normalizedCertKey ?? normalizedHost),
    };
    this.sessions.set(normalizedHost, session);
    return session;
  }

  async startPairing(host: string, certKey?: string): Promise<Record<string, unknown> | undefined> {
    record({ layer: 'pairing', direction: 'call', event: 'startPairing', meta: { host, certKey } });
    const session = await this.getSession(host, certKey);

    if (session.pairingReady) {
      await session.pairingReady;
      return {};
    }

    const pairingManager = new PairingManager(
      host,
      DEFAULT_PAIRING_PORT,
      session.certs,
      SERVICE_NAME
    );

    session.pairingManager = pairingManager;
    session.pairingReady = new Promise<void>((resolve, reject) => {
      pairingManager.on('secret', resolve);
      session.pairingComplete = pairingManager
        .start()
        .then((success) => {
          if (!success) {
            throw new Error('Pairing failed.');
          }
        })
        .catch((error: unknown) => {
          const normalized = toError(error, 'Pairing failed.');
          reject(normalized);
          throw normalized;
        })
        .finally(() => {
          session.pairingReady = undefined;
          session.pairingComplete = undefined;
          session.pairingManager = undefined;
        });
    });

    await session.pairingReady;
    return {};
  }

  async finishPairing(host: string, code: string, certKey?: string): Promise<void> {
    record({ layer: 'pairing', direction: 'call', event: 'finishPairing', meta: { host, certKey, codeLength: code.length } });
    const session = await this.getSession(host, certKey);
    if (!session.pairingManager || !session.pairingComplete) {
      throw new Error('No pairing session is active for this device.');
    }

    const accepted = session.pairingManager.sendCode(code.trim());
    if (!accepted) {
      await this.clearHostSession(host);
      throw new Error('Invalid pairing code. Request a new code and try again.');
    }

    try {
      await session.pairingComplete;
    } catch (error) {
      await this.clearHostSession(host);
      throw normalizeRemoteError(error, 'Pairing failed.');
    }
  }

  async connect(host: string, certKey?: string): Promise<Record<string, unknown> | undefined> {
    record({ layer: 'transport', direction: 'call', event: 'connect', meta: { host, certKey } });
    const session = await this.getSession(host, certKey);
    session.remoteClient ??= new NativeRemoteClient(host, session.certs, this.tlsConnector);

    try {
      await session.remoteClient.connect();
    } catch (error) {
      const normalized = normalizeRemoteError(error, `Could not connect to ${host}.`);
      if (isCertificateRejectedError(error)) {
        await this.clearHostSession(host, true, certKey);
      }
      throw normalized;
    }

    const snapshot = session.remoteClient.snapshot;

    return {
      current_app: snapshot.currentApp,
      is_on: snapshot.isOn,
      mac: undefined,
      name: snapshot.deviceInfo?.model ?? host,
    };
  }

  disconnect(host: string): void {
    const session = this.sessions.get(host.trim());
    session?.remoteClient?.disconnect();
    if (session) {
      session.remoteClient = undefined;
    }
  }

  async reset(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.remoteClient?.disconnect();
      session.remoteClient = undefined;
      session.pairingManager = undefined;
      session.pairingReady = undefined;
      session.pairingComplete = undefined;
    }

    this.sessions.clear();
    await this.fs.rmRecursive(getAppDataPath('androidtvremote'));
  }

  async sendCommand(
    host: string,
    request: CommandDispatchRequest,
    certKey?: string
  ): Promise<void> {
    const session = await this.getSession(host, certKey);
    session.remoteClient ??= new NativeRemoteClient(host, session.certs, this.tlsConnector);

    commandMetricsStore.recordBridgeSendStart(request, host);

    try {
      await session.remoteClient.connect(request.id);
      session.remoteClient.sendCommand(request);
      commandMetricsStore.recordCommandSucceeded(request.id);
    } catch (error) {
      const normalizedError = normalizeRemoteError(
        error,
        `Could not send ${request.command} to ${host}.`
      );
      const reason = normalizedError.message.includes('Connection has been lost.')
        ? 'socket_destroyed'
        : normalizedError.message.includes('timed out')
          ? 'connect_failed'
          : 'send_failed';
      commandMetricsStore.recordCommandFailed(request, {
        reason,
        errorMessage: normalizedError.message,
        host,
      });
      throw normalizedError;
    }
  }

  async sendText(host: string, text: string, certKey?: string): Promise<void> {
    const session = await this.getSession(host, certKey);
    session.remoteClient ??= new NativeRemoteClient(host, session.certs, this.tlsConnector);

    await session.remoteClient.connect();
    session.remoteClient.sendText(text);
  }

  async startAssistantVoice(host: string, certKey?: string): Promise<number> {
    record({ layer: 'voice', direction: 'call', event: 'startAssistantVoice', meta: { host } });
    const session = await this.getSession(host, certKey);
    session.remoteClient ??= new NativeRemoteClient(host, session.certs, this.tlsConnector);
    await session.remoteClient.connect();
    return session.remoteClient.startVoiceSession();
  }

  async sendAssistantVoiceChunk(
    host: string,
    sessionId: number,
    chunk: Buffer,
    certKey?: string
  ): Promise<void> {
    if (isCaptureEnabled()) {
      recordBuffer('voice', 'tx', 'voiceChunk', chunk, { host, sessionId, byteLength: chunk.byteLength });
    }
    const session = await this.getSession(host, certKey);
    session.remoteClient ??= new NativeRemoteClient(host, session.certs, this.tlsConnector);
    await session.remoteClient.connect();
    session.remoteClient.sendVoiceChunk(sessionId, chunk);
  }

  async stopAssistantVoice(host: string, sessionId: number, certKey?: string): Promise<void> {
    record({ layer: 'voice', direction: 'call', event: 'stopAssistantVoice', meta: { host, sessionId } });
    const session = await this.getSession(host, certKey);
    session.remoteClient ??= new NativeRemoteClient(host, session.certs, this.tlsConnector);
    await session.remoteClient.connect();
    session.remoteClient.stopVoiceSession(sessionId);
  }

  async hasPendingAssistantVoiceSession(host: string, certKey?: string): Promise<boolean> {
    const session = await this.getSession(host, certKey);
    session.remoteClient ??= new NativeRemoteClient(host, session.certs, this.tlsConnector);
    await session.remoteClient.connect();
    return Boolean(session.remoteClient.snapshot.voiceSessionId);
  }
}

/**
 * Factory: construct a fresh bridge. New code ( onward) should prefer this
 * over the singleton so each test gets an isolated session map. Production code
 * continues to use the `androidTvRemoteBridge` singleton below for backward
 * compatibility.
 */
export function createAndroidTvRemoteBridge(): AndroidTvRemoteBridge {
  return new AndroidTvRemoteBridge();
}

// Existing process-wide singleton — preserved for backward compatibility.
export const androidTvRemoteBridge = createAndroidTvRemoteBridge();
