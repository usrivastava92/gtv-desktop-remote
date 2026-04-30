import crypto, { X509Certificate } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { TLSSocket } from 'node:tls';
import tls from 'node:tls';

import protobuf from 'protobufjs';

import type { PemPair } from './certificate';

const PAIRING_PROTO = String.raw`syntax = "proto3";
package pairing;

enum RoleType {
  ROLE_TYPE_UNKNOWN = 0;
  ROLE_TYPE_INPUT = 1;
  ROLE_TYPE_OUTPUT = 2;
}

message PairingRequest {
  string client_name = 2;
  string service_name = 1;
}

message PairingRequestAck {
  string server_name = 1;
}

message PairingEncoding {
  enum EncodingType {
    ENCODING_TYPE_UNKNOWN = 0;
    ENCODING_TYPE_ALPHANUMERIC = 1;
    ENCODING_TYPE_NUMERIC = 2;
    ENCODING_TYPE_HEXADECIMAL = 3;
    ENCODING_TYPE_QRCODE = 4;
  }
  EncodingType type = 1;
  uint32 symbol_length = 2;
}

message PairingOption {
  repeated PairingEncoding input_encodings = 1;
  repeated PairingEncoding output_encodings = 2;
  RoleType preferred_role = 3;
}

message PairingConfiguration {
  PairingEncoding encoding = 1;
  RoleType client_role = 2;
}

message PairingConfigurationAck {}

message PairingSecret {
  bytes secret = 1;
}

message PairingSecretAck {
  bytes secret = 1;
}

message PairingMessage {
  enum Status {
    UNKNOWN = 0;
    STATUS_OK = 200;
    STATUS_ERROR = 400;
    STATUS_BAD_CONFIGURATION = 401;
    STATUS_BAD_SECRET = 402;
  }
  int32 protocol_version = 1;
  Status status = 2;
  int32 request_case = 3;
  PairingRequest pairing_request = 10;
  PairingRequestAck pairing_request_ack = 11;
  PairingOption pairing_option = 20;
  PairingConfiguration pairing_configuration = 30;
  PairingConfigurationAck pairing_configuration_ack = 31;
  PairingSecret pairing_secret = 40;
  PairingSecretAck pairing_secret_ack = 41;
}`;

const pairingRoot = protobuf.parse(PAIRING_PROTO).root;
const pairingMessageType = pairingRoot.lookupType('pairing.PairingMessage');
const pairingStatus = pairingRoot.lookupEnum('pairing.PairingMessage.Status').values;
const pairingRole = pairingRoot.lookupEnum('pairing.RoleType').values;
const pairingEncodingType = pairingRoot.lookupEnum('pairing.PairingEncoding.EncodingType').values;

interface PairingMessage {
  status?: number | string;
  pairingRequestAck?: Record<string, unknown>;
  pairingOption?: Record<string, unknown>;
  pairingConfigurationAck?: Record<string, unknown>;
  pairingSecretAck?: Record<string, unknown>;
}

function encodePairingMessage(payload: protobuf.Message | Record<string, unknown>): Buffer {
  const message = pairingMessageType.create(payload);
  return Buffer.from(pairingMessageType.encodeDelimited(message).finish());
}

function parsePairingMessage(buffer: Buffer): PairingMessage {
  return pairingMessageType.toObject(pairingMessageType.decodeDelimited(buffer), {
    enums: Number,
    longs: Number,
  });
}

function createPairingRequest(serviceName: string, clientName: string): Buffer {
  return encodePairingMessage({
    pairingRequest: {
      clientName,
      serviceName,
    },
    protocolVersion: 2,
    status: pairingStatus.STATUS_OK,
  });
}

function createPairingOption(): Buffer {
  return encodePairingMessage({
    pairingOption: {
      inputEncodings: [
        {
          symbolLength: 6,
          type: pairingEncodingType.ENCODING_TYPE_HEXADECIMAL,
        },
      ],
      preferredRole: pairingRole.ROLE_TYPE_INPUT,
    },
    protocolVersion: 2,
    status: pairingStatus.STATUS_OK,
  });
}

function createPairingConfiguration(): Buffer {
  return encodePairingMessage({
    pairingConfiguration: {
      clientRole: pairingRole.ROLE_TYPE_INPUT,
      encoding: {
        symbolLength: 6,
        type: pairingEncodingType.ENCODING_TYPE_HEXADECIMAL,
      },
    },
    protocolVersion: 2,
    status: pairingStatus.STATUS_OK,
  });
}

function createPairingSecret(secret: Buffer): Buffer {
  return encodePairingMessage({
    pairingSecret: { secret },
    protocolVersion: 2,
    status: pairingStatus.STATUS_OK,
  });
}

function decodeHex(value: string): Buffer {
  return Buffer.from(value, 'hex');
}

function base64UrlToHex(value: string | undefined): string {
  if (!value) {
    throw new Error('Missing certificate key material during pairing.');
  }

  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const hex = Buffer.from(padded, 'base64').toString('hex');
  if (!hex) {
    throw new Error('Missing certificate key material during pairing.');
  }

  return hex;
}

function normalizeHexForHash(value: string, prefixZero = false): string {
  const normalized = value
    .toLowerCase()
    .replace(/^0x/, '')
    .replace(/[^0-9a-f]/g, '');
  if (!normalized) {
    throw new Error('Missing certificate key material during pairing.');
  }

  const evenLength = normalized.length % 2 === 0 ? normalized : `0${normalized}`;
  return prefixZero ? `0${evenLength}` : evenLength;
}

function getCertificateKeyMaterialFromX509(certificate: X509Certificate): {
  exponent: string;
  modulus: string;
} {
  const jwk = certificate.publicKey.export({ format: 'jwk' }) as {
    e?: string;
    kty?: string;
    n?: string;
  };
  if (jwk.kty !== 'RSA') {
    throw new Error('Unsupported certificate key type during pairing.');
  }

  const modulus = normalizeHexForHash(base64UrlToHex(jwk.n));
  const exponent = normalizeHexForHash(base64UrlToHex(jwk.e), true);

  return {
    exponent,
    modulus,
  };
}

export class PairingManager extends EventEmitter<{
  secret: [];
}> {
  private client: TLSSocket | undefined;

  private chunks = Buffer.alloc(0);

  private pairingSecretAcknowledged = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly certs: PemPair,
    private readonly serviceName: string,
    private readonly clientName: string
  ) {
    super();
  }

  async start(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const client = tls.connect({
        cert: this.certs.cert,
        host: this.host,
        key: this.certs.key,
        port: this.port,
        rejectUnauthorized: false,
      });

      let settled = false;

      const finish = (result: boolean, error?: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      };

      this.client = client;
      this.pairingSecretAcknowledged = false;
      client.setTimeout(15000);

      client.on('timeout', () => {
        client.destroy(new Error('Pairing timed out. Request a new code and try again.'));
      });

      client.on('secureConnect', () => {
        client.write(createPairingRequest('atvremote', this.clientName));
      });

      client.on('data', (data) => {
        this.chunks = Buffer.concat([this.chunks, Buffer.from(data)]);
        if (this.chunks.length === 0 || this.chunks.readUInt8(0) !== this.chunks.length - 1) {
          return;
        }

        const message = parsePairingMessage(this.chunks);
        this.chunks = Buffer.alloc(0);

        if (message.status !== pairingStatus.STATUS_OK) {
          client.destroy(new Error(`Pairing failed with status ${String(message.status)}.`));
          return;
        }

        if (message.pairingRequestAck) {
          client.write(createPairingOption());
          return;
        }

        if (message.pairingOption) {
          client.write(createPairingConfiguration());
          return;
        }

        if (message.pairingConfigurationAck) {
          this.emit('secret');
          return;
        }

        if (message.pairingSecretAck) {
          this.pairingSecretAcknowledged = true;
          client.end();
        }
      });

      client.on('close', (hasError) => {
        if (hasError) {
          finish(false, new Error('Pairing connection closed unexpectedly.'));
          return;
        }

        if (!this.pairingSecretAcknowledged) {
          finish(false, new Error('Pairing did not complete. Request a new code and try again.'));
          return;
        }

        finish(true);
      });

      client.on('error', (error) => {
        finish(false, error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  sendCode(code: string): boolean {
    const client = this.client;
    if (!client) {
      throw new Error('No active pairing connection.');
    }

    const trimmedCode = code.trim();
    if (!/^[0-9A-Fa-f]{6}$/.test(trimmedCode)) {
      return false;
    }

    const peerCertificate = client.getPeerCertificate();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!peerCertificate.raw) {
      throw new Error('Missing server certificate during pairing.');
    }

    const clientCertificate = getCertificateKeyMaterialFromX509(
      new X509Certificate(this.certs.cert)
    );
    const serverCertificate = getCertificateKeyMaterialFromX509(
      new X509Certificate(peerCertificate.raw)
    );
    const hash = crypto.createHash('sha256');

    hash.update(decodeHex(clientCertificate.modulus));
    hash.update(decodeHex(clientCertificate.exponent));
    hash.update(decodeHex(serverCertificate.modulus));
    hash.update(decodeHex(serverCertificate.exponent));
    hash.update(decodeHex(trimmedCode.slice(2)));

    const secret = hash.digest();
    if (secret.readUInt8(0) !== Number.parseInt(trimmedCode.slice(0, 2), 16)) {
      client.destroy(new Error('Invalid pairing code.'));
      return false;
    }

    client.write(createPairingSecret(secret));
    return true;
  }
}
