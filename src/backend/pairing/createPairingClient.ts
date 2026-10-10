import type { PairingClient } from '@librecontrol/google-tv' with { 'resolution-mode': 'import' };

export interface PairingClientOptions {
  cert: string;
  clientName: string;
  host: string;
  key: string;
  port: number;
  rejectUnauthorized: boolean;
  timeoutMs?: number;
}

export async function createPairingClient(
  options: PairingClientOptions,
  onError: (error: Error) => void
): Promise<PairingClient> {
  // Electron's main process is compiled as CommonJS; this dependency is ESM-only.
  const { NodeTlsTransport, PairingClient } = await import('@librecontrol/google-tv');
  const transport = new NodeTlsTransport(options);
  // PairingClient subscribes only after TLS connects. Without an error listener,
  // NodeTlsTransport's error emission throws before it can reject connect().
  transport.on('error', onError);
  return new PairingClient({ ...options, transport });
}
