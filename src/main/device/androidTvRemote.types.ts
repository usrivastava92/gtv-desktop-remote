/**
 * Type definitions and constants for Android TV Remote functionality.
 * Extracted from androidTvRemote.ts to reduce complexity and enable reuse.
 */

import type { CommandDispatchRequest } from '../../shared/types';

import type { PemPair } from './protocol/certificate';

export interface RemoteClientPort {
  disconnect(): void;
  connect(commandId?: string): Promise<void>;
  sendCommand(request: CommandDispatchRequest): Promise<void> | void;
  sendText(text: string): Promise<void> | void;
  startVoiceSession(): Promise<number>;
  sendVoiceChunk(sessionId: number, samples: Buffer): Promise<void> | void;
  stopVoiceSession(sessionId: number): Promise<void> | void;
  readonly snapshot: RemoteState;
  readonly isConnected: boolean;
}

export interface PairingClientPort {
  close(): Promise<void>;
  start(): Promise<unknown>;
  submitCode(code: string): Promise<{ type: string; status?: string }>;
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
  pairingManager?: PairingClientPort;
  pairingReady?: Promise<void>;
  remoteClient?: RemoteClientPort;
}

/**
 * Android TV pairing port (default).
 */
export const DEFAULT_PAIRING_PORT = 6467;

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
