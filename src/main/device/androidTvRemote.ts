import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TLSSocket } from 'node:tls';
import tls from 'node:tls';

import type { CommandDispatchRequest } from '../../shared/types';
import { getAppDataPath, logError, logInfo } from '../logger';
import { commandMetricsStore } from '../metrics';

import { generateCertificate, type PemPair } from './protocol/certificate';
import {
  createImeBatchEditMessage,
  createRemoteConfigure,
  createRemoteKeyInject,
  createRemotePingResponse,
  createRemoteSetActive,
  parseRemoteMessage,
} from './protocol/remoteProtocol';

interface PairingManagerInstance {
  on(event: 'secret', listener: () => void): this;
  start(): Promise<boolean>;
  sendCode(code: string): boolean;
}

interface RemoteDeviceInfo {
  model?: string;
  vendor?: string;
  appVersion?: string;
}

interface RemoteState {
  currentApp?: string;
  isOn?: boolean;
  deviceInfo?: RemoteDeviceInfo;
  imeCounter: number;
  imeFieldCounter: number;
}

interface DeviceSession {
  certs: PemPair;
  pairingManager?: PairingManagerInstance;
  pairingReady?: Promise<void>;
  pairingComplete?: Promise<void>;
  remoteClient?: NativeRemoteClient;
}

const { PairingManager } = require('androidtv-remote/dist/pairing/PairingManager.js') as {
  PairingManager: new (
    host: string,
    port: number,
    certs: PemPair,
    serviceName: string
  ) => PairingManagerInstance;
};

const DEFAULT_PAIRING_PORT = 6467;
const REMOTE_FEATURES = 622;
const SERVICE_NAME = 'GTV Desktop Remote';

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string' && error.trim()) {
    return new Error(error);
  }

  if (typeof error === 'boolean') {
    return new Error(error ? fallback : 'Operation failed.');
  }

  return new Error(fallback);
}

function isCertificateRejectedError(error: unknown): boolean {
  const message = toError(error, '').message;
  return message.includes('SSLV3_ALERT_CERTIFICATE_UNKNOWN') || message.includes('alert number 46');
}

function normalizeRemoteError(error: unknown, fallback: string): Error {
  const normalized = toError(error, fallback);

  if (isCertificateRejectedError(normalized)) {
    return new Error(
      'The TV rejected the saved pairing certificate. Start pairing again. If this keeps happening, remove this remote from the TV and pair again.'
    );
  }

  if (normalized.message.includes('Remote connection timed out.')) {
    return new Error(
      'The TV did not respond on the Android TV Remote port. Make sure the TV is awake and Android TV Remote Service is available, then try pairing again.'
    );
  }

  return normalized;
}

class NativeRemoteClient {
  private socket: TLSSocket | undefined;

  private connectPromise: Promise<void> | undefined;

  private buffer = Buffer.alloc(0);

  private state: RemoteState = {
    imeCounter: 0,
    imeFieldCounter: 0,
  };

  constructor(
    private readonly host: string,
    private readonly certs: PemPair
  ) {}

  get snapshot(): RemoteState {
    return this.state;
  }

  get isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  async connect(commandId?: string): Promise<void> {
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
      const socket = tls.connect({
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

      socket.setTimeout(10000);
      socket.on('timeout', () => {
        socket.destroy(new Error('Remote connection timed out.'));
      });
      socket.on('secureConnect', () => {
        if (!settled) {
          settled = true;
          resolve();
        }

        if (commandId) {
          commandMetricsStore.recordConnectCompleted(this.host, commandId);
        }
      });
      socket.on('data', (chunk) => {
        commandMetricsStore.recordInboundMessage(this.host);
        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
        this.flushBuffer();
      });
      socket.on('error', fail);
      socket.on('close', () => {
        commandMetricsStore.recordSocketClosed(this.host);
        this.socket = undefined;
        this.buffer = Buffer.alloc(0);
      });

      this.socket = socket;
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
    this.buffer = Buffer.alloc(0);
  }

  sendCommand(request: CommandDispatchRequest): void {
    const socket = this.getSocket();
    const wroteImmediately = socket.write(createRemoteKeyInject(request.command));
    commandMetricsStore.recordSocketWrite(request, {
      host: this.host,
      buffered: !wroteImmediately,
    });
    if (!wroteImmediately) {
      socket.once('drain', () => {
        commandMetricsStore.recordSocketDrain(this.host, request.id);
      });
    }
  }

  sendText(text: string): void {
    const value = text.trim();
    if (!value) {
      throw new Error('Text cannot be empty.');
    }

    const socket = this.getSocket();
    socket.write(
      createImeBatchEditMessage(this.state.imeCounter, this.state.imeFieldCounter, value)
    );
  }

  private getSocket(): TLSSocket {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Connection has been lost.');
    }

    return this.socket;
  }

  private flushBuffer(): void {
    while (this.buffer.length > 0 && this.buffer.readInt8(0) === this.buffer.length - 1) {
      const message = parseRemoteMessage(this.buffer);
      this.handleMessage(message);
      this.buffer = Buffer.alloc(0);
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
    remoteStart?: { started?: boolean };
  }): void {
    if (message.remoteConfigure) {
      this.state.deviceInfo = {
        appVersion: message.remoteConfigure.deviceInfo?.appVersion,
        model: message.remoteConfigure.deviceInfo?.model,
        vendor: message.remoteConfigure.deviceInfo?.vendor,
      };
      this.getSocket().write(createRemoteConfigure(REMOTE_FEATURES));
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
    }
  }
}

class AndroidTvRemoteBridge {
  private readonly sessions = new Map<string, DeviceSession>();

  private getStateDir(): string {
    return getAppDataPath('androidtvremote');
  }

  private getFilesForCertKey(certKey: string): { certPath: string; keyPath: string } {
    const safeKey = certKey.replaceAll(':', '_').replaceAll('/', '_');
    const stateDir = this.getStateDir();

    return {
      certPath: path.join(stateDir, `${safeKey}.cert.pem`),
      keyPath: path.join(stateDir, `${safeKey}.key.pem`),
    };
  }

  /** @deprecated Use getFilesForCertKey with a macAddress-based key */
  private getFilesForHost(host: string): { certPath: string; keyPath: string } {
    return this.getFilesForCertKey(host);
  }

  /**
   * Migrate certs from old IP-based filename to MAC-based filename.
   * Safe to call even if the old file doesn't exist.
   */
  async migrateCerts(oldHost: string, macAddress: string): Promise<void> {
    const oldFiles = this.getFilesForCertKey(oldHost);
    const newFiles = this.getFilesForCertKey(macAddress);

    // Nothing to migrate if they are the same key or new file already exists
    if (oldFiles.certPath === newFiles.certPath) {
      return;
    }

    try {
      await fs.access(newFiles.certPath);
      // New cert already exists — remove the old IP-keyed file if present
      await Promise.all([
        fs.rm(oldFiles.certPath, { force: true }),
        fs.rm(oldFiles.keyPath, { force: true }),
      ]);
    } catch {
      // New cert does not exist — try to rename old one
      try {
        await fs.mkdir(this.getStateDir(), { recursive: true });
        await Promise.all([
          fs.rename(oldFiles.certPath, newFiles.certPath),
          fs.rename(oldFiles.keyPath, newFiles.keyPath),
        ]);
        await logInfo('androidtvremote', 'Migrated cert from IP key to MAC key', {
          oldHost,
          macAddress,
        });
      } catch {
        // Old cert did not exist either — nothing to migrate
      }
    }
  }

  private async loadOrCreateCerts(certKey: string): Promise<PemPair> {
    const { certPath, keyPath } = this.getFilesForCertKey(certKey);

    try {
      const [cert, key] = await Promise.all([
        fs.readFile(certPath, 'utf8'),
        fs.readFile(keyPath, 'utf8'),
      ]);

      return { cert, key };
    } catch {
      const certs = generateCertificate(SERVICE_NAME);
      await fs.mkdir(this.getStateDir(), { recursive: true });
      await Promise.all([
        fs.writeFile(certPath, certs.cert, 'utf8'),
        fs.writeFile(keyPath, certs.key, 'utf8'),
      ]);
      await logInfo('androidtvremote', 'Generated new client certificate', { certKey });
      return certs;
    }
  }

  private async clearPersistedHostState(certKey: string): Promise<void> {
    const { certPath, keyPath } = this.getFilesForCertKey(certKey);
    await Promise.all([fs.rm(certPath, { force: true }), fs.rm(keyPath, { force: true })]);
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

    const existing = this.sessions.get(normalizedHost);
    if (existing) {
      return existing;
    }

    const session: DeviceSession = {
      certs: await this.loadOrCreateCerts(certKey ?? normalizedHost),
    };
    this.sessions.set(normalizedHost, session);
    return session;
  }

  async startPairing(host: string, certKey?: string): Promise<Record<string, unknown> | undefined> {
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
    const session = await this.getSession(host, certKey);
    session.remoteClient ??= new NativeRemoteClient(host, session.certs);

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
    await fs.rm(this.getStateDir(), { force: true, recursive: true });
  }

  async sendCommand(
    host: string,
    request: CommandDispatchRequest,
    certKey?: string
  ): Promise<void> {
    const session = await this.getSession(host, certKey);
    session.remoteClient ??= new NativeRemoteClient(host, session.certs);

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
    session.remoteClient ??= new NativeRemoteClient(host, session.certs);

    await session.remoteClient.connect();
    session.remoteClient.sendText(text);
  }
}

export const androidTvRemoteBridge = new AndroidTvRemoteBridge();
