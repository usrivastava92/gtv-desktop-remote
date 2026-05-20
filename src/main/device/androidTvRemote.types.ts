/**
 * Type definitions and constants for Android TV Remote functionality.
 * Extracted from androidTvRemote.ts to reduce complexity and enable reuse.
 */

import type { PemPair } from './protocol/certificate';

// Forward declaration - NativeRemoteClient is defined in androidTvRemote.ts
declare class NativeRemoteClient {
  disconnect(): void;
  connect(commandId?: string): Promise<void>;
  sendCommand(request: any): void;
  sendText(text: string): void;
  startVoiceSession(): Promise<number>;
  sendVoiceChunk(sessionId: number, samples: Buffer): void;
  stopVoiceSession(sessionId: number): void;
  get snapshot(): RemoteState;
  get isConnected(): boolean;
}

/**
 * Pairing manager instance from the androidtv-remote library.
 * Handles the pairing protocol flow (start, secret generation, code validation).
 */
export interface PairingManagerInstance {
  on(event: 'secret', listener: () => void): this;
  start(): Promise<boolean>;
  sendCode(code: string): boolean;
}

/**
 * Device information retrieved from the TV during connection.
 * Partial/optional fields because the TV may not report all of these.
 */
export interface RemoteDeviceInfo {
  model?: string;
  vendor?: string;
  appVersion?: string;
}

/**
 * Snapshot of the TV remote's current state.
 * Updated incrementally as protocol messages are received.
 */
export interface RemoteState {
  currentApp?: string;
  isOn?: boolean;
  deviceInfo?: RemoteDeviceInfo;
  imeCounter: number;
  imeFieldCounter: number;
  lastActivityAt: number;
  voiceSessionId?: number;
}

/**
 * Session data for a connected device.
 * Holds certificates, pairing state, and the active remote client.
 */
export interface DeviceSession {
  certs: PemPair;
  pairingManager?: PairingManagerInstance;
  pairingReady?: Promise<void>;
  pairingComplete?: Promise<void>;
  remoteClient?: NativeRemoteClient;
}

/**
 * Android TV pairing port (default).
 */
export const DEFAULT_PAIRING_PORT = 6467;

/**
 * Remote feature flags sent during device configuration.
 */
export const REMOTE_FEATURES = 622;

/**
 * Connection stale threshold: if no inbound messages received for this long,
 * force a reconnect (detects half-open sockets after app suspension).
 */
export const REMOTE_STALE_AFTER_MS = 30_000;

/**
 * TLS connection timeout. Destroy the socket if not ready within this window.
 */
export const REMOTE_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Voice session initialization timeout. Abort if TV doesn't open session in time.
 */
export const REMOTE_VOICE_BEGIN_TIMEOUT_MS = 2_000;

/**
 * Service name advertised to the TV during pairing.
 */
export const SERVICE_NAME = 'GTV Desktop Remote';

/**
 * Convert any value to an Error, with a fallback message.
 */
export function toError(error: unknown, fallback: string): Error {
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

/**
 * Check if an error is a certificate rejection from the TV.
 */
export function isCertificateRejectedError(error: unknown): boolean {
  const message = toError(error, '').message;
  return message.includes('SSLV3_ALERT_CERTIFICATE_UNKNOWN') || message.includes('alert number 46');
}

/**
 * Normalize errors from the TLS layer or protocol to user-facing messages.
 * Handles certificate rejection, timeouts, and other common failures.
 */
export function normalizeRemoteError(error: unknown, fallback: string): Error {
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
