import { createHash, createPublicKey } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createTcpServer } from 'node:net';
import { createServer, type Server, type TLSSocket } from 'node:tls';

import type { PairingClient, PairingMessage } from '@librecontrol/google-tv' with {
  'resolution-mode': 'import',
};
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { generateCertificate, type PemPair } from '../../protocol/androidtv/certificate';
import { createPairingClient } from '../createPairingClient';

// The production CommonJS → ESM loading boundary must be exercised here too.
const protocol = import('@librecontrol/google-tv');

describe('pairing over real TLS', () => {
  let local: PemPair;
  let peer: PemPair;
  let server: Server | undefined;
  const sockets = new Set<TLSSocket>();
  const clients: PairingClient[] = [];

  beforeAll(() => {
    local = generateCertificate('pairing-client');
    peer = generateCertificate('pairing-server');
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (server) {
      const closed = once(server, 'close');
      server.close();
      await closed;
      server = undefined;
    }
  });

  async function client(port: number, errors: Error[], timeoutMs = 1000) {
    const result = await createPairingClient(
      {
        ...local,
        host: '127.0.0.1',
        port,
        clientName: 'pairing-regression',
        rejectUnauthorized: false,
        timeoutMs,
      },
      (error) => errors.push(error)
    );
    clients.push(result);
    return result;
  }

  async function pairingServer(reply = true) {
    const { FrameParser, decodePairingMessage, encodeFrame, encodePairingMessage } = await protocol;
    const received: PairingMessage[] = [];
    server = createServer(
      { ...peer, ca: local.cert, requestCert: true, rejectUnauthorized: true },
      (socket) => {
        expect(socket.authorized).toBe(true);
        sockets.add(socket);
        const parser = new FrameParser();
        socket.on('data', (data: Buffer) => {
          for (const frame of parser.push(data)) {
            const message = decodePairingMessage(frame);
            received.push(message);
            if (!reply) continue;
            const type =
              message.type === 'request'
                ? 'request-ack'
                : message.type === 'configuration'
                  ? 'configuration-ack'
                  : message.type === 'secret'
                    ? 'secret-ack'
                    : 'options';
            socket.write(encodeFrame(encodePairingMessage({ type, status: 'ok' })));
          }
        });
      }
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TLS server port');
    return { port: address.port, received };
  }

  function expectedSecret() {
    const hash = createHash('sha256');
    for (const certificate of [local.cert, peer.cert]) {
      const key = createPublicKey(certificate).export({ format: 'jwk' });
      if (!key.n || !key.e) throw new Error('Expected an RSA certificate');
      hash.update(Buffer.from(key.n, 'base64url'));
      hash.update(Buffer.from(key.e, 'base64url'));
    }
    return hash.update(Buffer.from('0bdb', 'hex')).digest();
  }

  it('rejects a refused pairing port instead of leaving start pending', async () => {
    const reservation = createTcpServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Missing reserved port');
    const closed = once(reservation, 'close');
    reservation.close();
    await closed;

    const errors: Error[] = [];
    const pairing = await client(address.port, errors);
    await expect(pairing.start()).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('completes configuration and sends the certificate-bound secret', async () => {
    const { port, received } = await pairingServer();
    const errors: Error[] = [];
    const pairing = await client(port, errors);
    await expect(pairing.start()).resolves.toMatchObject({
      type: 'configuration-ack',
      status: 'ok',
    });
    const secret = expectedSecret();
    const code = `${secret.subarray(0, 1).toString('hex')}0bdb`;
    await expect(pairing.submitCode(code)).resolves.toMatchObject({
      type: 'secret-ack',
      status: 'ok',
    });
    expect(received.map((message) => message.type)).toEqual([
      'request',
      'options',
      'configuration',
      'secret',
    ]);
    const message = received.find((item) => item.type === 'secret');
    expect(message?.type === 'secret' ? Buffer.from(message.secret) : undefined).toEqual(secret);
    expect(errors).toEqual([]);
  });

  it('keeps local hash validation and never sends a mismatched secret', async () => {
    const { port, received } = await pairingServer();
    const pairing = await client(port, []);
    await pairing.start();
    const secret = expectedSecret();
    const wrongPrefix = Buffer.from([(secret[0] ?? 0) ^ 0xff]).toString('hex');
    await expect(pairing.submitCode(`${wrongPrefix}0bdb`)).rejects.toThrow(
      'pairing code failed local certificate hash validation'
    );
    expect(received.map((message) => message.type)).toEqual([
      'request',
      'options',
      'configuration',
    ]);
  });

  it('rejects a service that connects but does not answer the pairing request', async () => {
    const { port, received } = await pairingServer(false);
    const pairing = await client(port, [], 100);
    await expect(pairing.start()).rejects.toThrow('timed out waiting for pairing reply to request');
    expect(received.map((message) => message.type)).toEqual(['request']);
  });
});
