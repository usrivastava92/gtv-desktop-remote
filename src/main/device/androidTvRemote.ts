import { promises as fs } from 'node:fs';
import path from 'node:path';
import tls, { TLSSocket } from 'node:tls';

import type { RemoteCommand } from '../../shared/types';
import { getAppDataPath, logError, logInfo } from '../logger';
import { generateCertificate, type PemPair } from './protocol/certificate';
import {
  createImeBatchEditMessage,
  createRemoteConfigure,
  createRemoteKeyInject,
  createRemotePingResponse,
  createRemoteSetActive,
  parseRemoteMessage
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
    serviceName: string,
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
    imeFieldCounter: 0
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

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = tls.connect({
        cert: this.certs.cert,
        host: this.host,
        key: this.certs.key,
        port: 6466,
        rejectUnauthorized: false
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
      });
      socket.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
        this.flushBuffer();
      });
      socket.on('error', fail);
      socket.on('close', () => {
        this.socket = undefined;
        this.buffer = Buffer.alloc(0);
      });

      this.socket = socket;
    }).finally(() => {
      this.connectPromise = undefined;
    });

    return this.connectPromise;
  }

  disconnect(): void {
    if (!this.socket) {
      return;
    }

    this.socket.removeAllListeners('close');
    this.socket.destroy();
    this.socket = undefined;
    this.buffer = Buffer.alloc(0);
  }

  sendCommand(command: RemoteCommand): void {
    const socket = this.getSocket();
    socket.write(createRemoteKeyInject(command));
  }

  sendText(text: string): void {
    const value = text.trim();
    if (!value) {
      throw new Error('Text cannot be empty.');
    }

    const socket = this.getSocket();
    socket.write(createImeBatchEditMessage(this.state.imeCounter, this.state.imeFieldCounter, value));
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
    remoteConfigure?: { code1?: number; deviceInfo?: { appVersion?: string; model?: string; vendor?: string } };
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
        vendor: message.remoteConfigure.deviceInfo?.vendor
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
      this.state.imeFieldCounter = message.remoteImeBatchEdit.fieldCounter ?? this.state.imeFieldCounter;
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

  private getFilesForHost(host: string): { certPath: string; keyPath: string } {
    const hostKey = host.replaceAll(':', '_').replaceAll('/', '_');
    const stateDir = this.getStateDir();

    return {
      certPath: path.join(stateDir, `${hostKey}.cert.pem`),
      keyPath: path.join(stateDir, `${hostKey}.key.pem`)
    };
  }

  private async loadOrCreateCerts(host: string): Promise<PemPair> {
    const { certPath, keyPath } = this.getFilesForHost(host);

    try {
      const [cert, key] = await Promise.all([
        fs.readFile(certPath, 'utf8'),
        fs.readFile(keyPath, 'utf8')
      ]);

      return { cert, key };
    } catch {
      const certs = generateCertificate(SERVICE_NAME);
      await fs.mkdir(this.getStateDir(), { recursive: true });
      await Promise.all([
        fs.writeFile(certPath, certs.cert, 'utf8'),
        fs.writeFile(keyPath, certs.key, 'utf8')
      ]);
      await logInfo('androidtvremote', 'Generated new client certificate', { host });
      return certs;
    }
  }

  private async clearPersistedHostState(host: string): Promise<void> {
    const { certPath, keyPath } = this.getFilesForHost(host);
    await Promise.all([
      fs.rm(certPath, { force: true }),
      fs.rm(keyPath, { force: true })
    ]);
  }

  private async clearHostSession(host: string, removeCerts = false): Promise<void> {
    const normalizedHost = host.trim();
    const session = this.sessions.get(normalizedHost);

    session?.remoteClient?.disconnect();
    this.sessions.delete(normalizedHost);

    if (removeCerts) {
      await this.clearPersistedHostState(normalizedHost);
    }
  }

  private async getSession(host: string): Promise<DeviceSession> {
    const normalizedHost = host.trim();
    if (!normalizedHost) {
      throw new Error('Missing host');
    }

    const existing = this.sessions.get(normalizedHost);
    if (existing) {
      return existing;
    }

    const session: DeviceSession = {
      certs: await this.loadOrCreateCerts(normalizedHost)
    };
    this.sessions.set(normalizedHost, session);
    return session;
  }

  async startPairing(host: string): Promise<Record<string, unknown> | undefined> {
    const session = await this.getSession(host);

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
      session.pairingComplete = pairingManager.start().then((success) => {
        if (!success) {
          throw new Error('Pairing failed.');
        }
      }).catch((error) => {
        const normalized = toError(error, 'Pairing failed.');
        reject(normalized);
        throw normalized;
      }).finally(() => {
        session.pairingReady = undefined;
        session.pairingComplete = undefined;
        session.pairingManager = undefined;
      });
    });

    await session.pairingReady;
    return {};
  }

  async finishPairing(host: string, code: string): Promise<void> {
    const session = await this.getSession(host);
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

  async connect(host: string): Promise<Record<string, unknown> | undefined> {
    const session = await this.getSession(host);
    if (!session.remoteClient) {
      session.remoteClient = new NativeRemoteClient(host, session.certs);
    }

    try {
      await session.remoteClient.connect();
    } catch (error) {
      const normalized = normalizeRemoteError(error, `Could not connect to ${host}.`);
      if (isCertificateRejectedError(error)) {
        await this.clearHostSession(host, true);
      }
      throw normalized;
    }

    const snapshot = session.remoteClient.snapshot;

    return {
      current_app: snapshot.currentApp,
      is_on: snapshot.isOn,
      mac: undefined,
      name: snapshot.deviceInfo?.model ?? host
    };
  }

  async disconnect(host: string): Promise<void> {
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

  async sendCommand(host: string, command: RemoteCommand): Promise<void> {
    const session = await this.getSession(host);
    if (!session.remoteClient) {
      session.remoteClient = new NativeRemoteClient(host, session.certs);
    }

    await session.remoteClient.connect();
    session.remoteClient.sendCommand(command);
  }

  async sendText(host: string, text: string): Promise<void> {
    const session = await this.getSession(host);
    if (!session.remoteClient) {
      session.remoteClient = new NativeRemoteClient(host, session.certs);
    }

    await session.remoteClient.connect();
    session.remoteClient.sendText(text);
  }
}

export const androidTvRemoteBridge = new AndroidTvRemoteBridge();