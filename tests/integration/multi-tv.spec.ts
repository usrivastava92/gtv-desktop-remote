import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import path from 'node:path';

import type { RemoteCommand } from '../../src/shared/types';

import { test, expect, repository } from './app-harness';

/**
 * Independent receiver model for @librecontrol/fire-tv 1.1.0's published native
 * HTTP protocol (dist/FireTvDevice.js and dist/transport/http.js). No app or
 * library methods are replaced. This is not a claim of physical Fire OS parity:
 * SSDP/mDNS discovery, TLS trust provisioning and voice are outside this model.
 */
const DIAL_SERVICE = 'urn:dial-multiscreen-org:service:dial:1';

class FireReceiver {
  readonly token = `local-receiver-${randomUUID()}`;
  readonly pin = '4826';
  readonly errors: string[] = [];
  readonly requests: Array<{ method: string; path: string; authenticated: boolean }> = [];
  readonly launches: Array<{
    method: string;
    path: string;
    headers: IncomingMessage['headers'];
    body: string;
  }> = [];
  readonly keys: string[] = [];
  phase: 'idle' | 'pin-displayed' | 'paired' = 'idle';
  displays = 0;
  rejectedPins = 0;
  statuses = 0;
  text = '';
  keyboardVisible = true;
  held?: string;
  port = 0;
  dialPort = 0;
  active = true;
  launchStatus = 201;
  nativeStarts = 0;
  private startupTimer?: NodeJS.Timeout;
  private dialServer?: Server;
  private server?: Server;

  async start(protocol: 'http' | 'https') {
    const receive = (request: IncomingMessage, response: ServerResponse) => {
      void this.receive(request, response).catch((error: unknown) => {
        this.errors.push(String(error));
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    };
    this.server =
      protocol === 'http'
        ? createHttpServer(receive)
        : createHttpsServer(
            {
              // The checked-in certificate/key pair is used only by this local TLS receiver.
              cert: await readFile(
                path.join(repository, 'tests/integration/fixtures/protocol/client-certificate.pem')
              ),
              key: await readFile(
                path.join(repository, 'tests/integration/fixtures/protocol/client-key.pem')
              ),
            },
            receive
          );
    const listening = once(this.server, 'listening');
    this.server.listen(0, '127.0.0.1');
    await listening;
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Receiver did not bind TCP');
    this.port = address.port;
    this.dialServer = createHttpServer((request, response) => {
      void this.receiveLaunch(request, response).catch((error: unknown) => {
        this.errors.push(String(error));
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    const dialListening = once(this.dialServer, 'listening');
    this.dialServer.listen(0, '127.0.0.1');
    await dialListening;
    const dialAddress = this.dialServer.address();
    if (!dialAddress || typeof dialAddress === 'string') throw new Error('DIAL did not bind TCP');
    this.dialPort = dialAddress.port;
  }

  async pauseNative() {
    if (!this.server?.listening) throw new Error('Native receiver is not listening');
    this.active = false;
    this.server.closeAllConnections();
    const closed = once(this.server, 'close');
    this.server.close();
    await closed;
  }

  async stop() {
    clearTimeout(this.startupTimer);
    for (const server of [this.server, this.dialServer]) {
      if (!server?.listening) continue;
      server.closeAllConnections();
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  }

  private async receiveLaunch(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const launch = {
      method: request.method ?? '',
      path: request.url ?? '',
      headers: request.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    };
    this.launches.push(launch);
    this.requests.push({ method: launch.method, path: launch.path, authenticated: false });
    if (launch.method !== 'POST' || launch.path !== '/apps/FireTVRemote') {
      this.errors.push('Unexpected DIAL request');
      response.writeHead(404);
    } else {
      if (this.launchStatus === 201) this.active = true;
      response.writeHead(this.launchStatus, { Location: '/apps/FireTVRemote/run' });
    }
    response.end();
    if (this.launchStatus === 201 && !this.server?.listening && !this.startupTimer) {
      // The DIAL response is already complete, but native TCP still refuses connections.
      this.startupTimer = setTimeout(() => {
        this.startupTimer = undefined;
        this.server?.listen(this.port, '127.0.0.1', () => {
          this.nativeStarts++;
        });
      }, 200);
    }
  }

  private async receive(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    const body: Record<string, unknown> = raw ? JSON.parse(raw) : {};
    const url = new URL(request.url ?? '/', 'http://receiver.invalid');
    const authenticated = request.headers['x-client-token'] === this.token;
    this.requests.push({
      method: request.method ?? '',
      path: url.pathname + url.search,
      authenticated,
    });
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (!this.active) {
      reply(503, {});
      return;
    }
    if (request.headers['x-api-key'] !== '0987654321') {
      this.errors.push('Missing native API key');
      reply(403, {});
      return;
    }
    if (url.pathname === '/v1/FireTV/pin/display' && request.method === 'POST') {
      if (typeof body.friendlyName !== 'string' || !body.friendlyName) {
        this.errors.push('PIN display missing friendlyName');
        reply(400, {});
        return;
      }
      this.phase = 'pin-displayed';
      this.displays++;
      reply(200, { description: 'OK' });
      return;
    }
    if (url.pathname === '/v1/FireTV/pin/verify' && request.method === 'POST') {
      if (this.phase !== 'pin-displayed') {
        this.errors.push('PIN verified without display');
        reply(409, {});
      } else if (body.pin !== this.pin) {
        this.rejectedPins++;
        reply(200, { description: '' });
      } else {
        this.phase = 'paired';
        reply(200, { description: this.token });
      }
      return;
    }
    if (!authenticated || this.phase !== 'paired') {
      reply(401, {});
      return;
    }
    if (url.pathname === '/v1/FireTV/status' && request.method === 'GET') {
      this.statuses++;
      reply(200, { osVersion: 'local-model', platformType: 'fireTV', turnstileVersion: '1' });
      return;
    }
    if (url.pathname === '/v1/FireTV/keyboard') {
      if (request.method === 'GET') {
        reply(200, {
          state: this.keyboardVisible ? 'visible' : 'hidden',
          mode: 'text',
          text: this.text,
        });
        return;
      }
      if (request.method === 'POST' && this.keyboardVisible && typeof body.text === 'string') {
        this.text = body.text;
        reply(200, {});
        return;
      }
    }
    if (url.pathname === '/v1/FireTV' && request.method === 'POST') {
      const action = url.searchParams.get('action') ?? '';
      if (['dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'select'].includes(action)) {
        if (body.keyActionType === 'keyDown' && this.held === undefined) {
          this.held = action;
          reply(200, {});
          return;
        }
        if (body.keyActionType === 'keyUp' && this.held === action) {
          this.held = undefined;
          this.keys.push(action);
          reply(200, {});
          return;
        }
      } else if (['home', 'back', 'power'].includes(action) && raw === '') {
        this.keys.push(action);
        reply(200, {});
        return;
      }
    }
    if (
      url.pathname === '/v1/media' &&
      url.search === '?action=play' &&
      request.method === 'POST' &&
      raw === ''
    ) {
      this.keys.push('play');
      reply(200, {});
      return;
    }
    this.errors.push(`Unexpected receiver request ${request.method} ${url.pathname}${url.search}`);
    reply(400, {});
  }
}

for (const { protocol, serviceName, label } of [
  { protocol: 'http', serviceName: undefined, label: 'http' },
  {
    protocol: 'https',
    serviceName: 'Living Room._amzn-fireTv._tcp.local.',
    label: 'https-mdns',
  },
  { protocol: 'https', serviceName: DIAL_SERVICE, label: 'https-dial' },
] as const) {
  test(`MULTI-TV-FIRE-${label}: real provider PIN, stored token, controls and text`, async ({
    harness: h,
  }, info) => {
    const receiver = new FireReceiver();
    await receiver.start(protocol);
    const requiresLaunch = serviceName === DIAL_SERVICE;
    receiver.active = !requiresLaunch;
    if (requiresLaunch) await receiver.pauseNative();
    try {
      const devices = await h.api('saveDevice', {
        name: `Fire receiver ${protocol}`,
        host: '127.0.0.1',
        adbPort: 5555,
        platform: 'fire-tv',
        providerData: {
          port: receiver.port,
          dialPort: receiver.dialPort,
          protocol,
          rejectUnauthorized: 0,
          ...(serviceName ? { serviceName } : {}),
        },
      });
      const device = devices.find((entry) => entry.platform === 'fire-tv');
      expect(device).toBeDefined();
      if (!device) throw new Error('Fire device not saved');
      expect(receiver.requests).toEqual([]);
      expect(receiver.launches).toEqual([]);
      if (requiresLaunch) {
        receiver.launchStatus = 503;
        await expect(h.api('startPairing', device.id)).rejects.toThrow(
          'Fire TV HTTP request failed (503)'
        );
        expect(receiver.requests.map((request) => request.path)).toEqual(['/apps/FireTVRemote']);
        expect(receiver.displays).toBe(0);
        expect(receiver.statuses).toBe(0);
        expect(receiver.active).toBe(false);
        receiver.launchStatus = 201;
      }
      for (const platform of ['google-tv', 'apple-tv']) {
        await h.api('saveDevice', {
          name: `${platform} same address`,
          host: device.host,
          adbPort: 5555,
          platform,
        });
      }
      const sameHost = (await h.api('bootstrap')).devices.filter(
        (entry) => entry.host === device.host
      );
      expect(new Set(sameHost.map((entry) => entry.id)).size).toBe(3);
      expect(sameHost.map((entry) => entry.platform ?? 'google-tv').sort()).toEqual([
        'apple-tv',
        'fire-tv',
        'google-tv',
      ]);
      const pairing = await h.api('startPairing', device.id);
      expect(pairing.pairing).toMatchObject({ codeLength: 4 });
      expect(receiver.phase).toBe('pin-displayed');
      expect(receiver.displays).toBe(1);
      expect(receiver.nativeStarts).toBe(requiresLaunch ? 1 : 0);
      await h.api('disconnect');
      const canceledRequests = receiver.requests.length;
      await expect(
        h.api('pair', { deviceId: device.id, host: device.host, code: receiver.pin })
      ).rejects.toThrow();
      expect(receiver.requests).toHaveLength(canceledRequests);
      expect((await h.api('bootstrap')).deviceState.pairing).toBeUndefined();
      await h.api('startPairing', device.id);
      await expect(
        h.api('pair', { deviceId: device.id, host: device.host, code: '0000' })
      ).rejects.toThrow();
      expect(receiver.rejectedPins).toBe(1);
      expect(receiver.phase).toBe('pin-displayed');
      expect(
        (await h.api('bootstrap')).devices.find((entry) => entry.id === device.id)?.isPaired
      ).not.toBe(true);
      await h.api('startPairing', device.id);
      await h.api('pair', { deviceId: device.id, host: device.host, code: receiver.pin });
      expect(receiver.phase).toBe('paired');
      expect((await h.api('bootstrap')).deviceState.pairing).toBeUndefined();
      if (requiresLaunch) {
        receiver.active = false;
        receiver.launchStatus = 503;
        const beforeFailure = receiver.requests.length;
        await expect(h.api('connect', device.id)).rejects.toThrow(
          'Fire TV HTTP request failed (503)'
        );
        expect(receiver.requests.slice(beforeFailure).map((request) => request.path)).toEqual([
          '/apps/FireTVRemote',
        ]);
        expect(receiver.statuses).toBe(0);
        expect(receiver.active).toBe(false);
        receiver.launchStatus = 201;
      }
      expect((await h.api('connect', device.id)).status).toBe('connected');
      const capabilities = await h.api('capabilities');
      expect(capabilities.assistantVoice).toBe(false);
      expect(capabilities.supportedCommands).not.toContain('volume_up');
      expect(capabilities.supportedCommands).not.toContain('home_hold');
      for (const command of [
        'up',
        'down',
        'left',
        'right',
        'select',
        'home',
        'back',
        'power',
        'play_pause',
      ] as const) {
        await h.api('sendCommand', {
          id: randomUUID(),
          command,
          issuedAt: Date.now(),
          source: 'button',
        });
      }
      expect(receiver.keys).toEqual([
        'dpad_up',
        'dpad_down',
        'dpad_left',
        'dpad_right',
        'select',
        'home',
        'back',
        'power',
        'play',
      ]);
      expect(receiver.held).toBeUndefined();
      const beforeUnsupported = receiver.requests.length;
      for (const command of [
        'home_hold',
        'volume_up',
        'volume_down',
        'assistant_press',
        'assistant_release',
      ] as RemoteCommand[]) {
        await expect(
          h.api('sendCommand', {
            id: randomUUID(),
            command,
            issuedAt: Date.now(),
            source: 'keyboard',
          })
        ).rejects.toThrow();
      }
      await expect(h.api('startAssistantVoice')).rejects.toThrow();
      expect(receiver.requests).toHaveLength(beforeUnsupported);
      receiver.keyboardVisible = false;
      await expect(h.api('sendText', 'must not reach hidden keyboard')).rejects.toThrow();
      expect(receiver.text).toBe('');
      receiver.keyboardVisible = true;
      await h.api('sendText', 'Fire 世界 🎬 é');
      expect(receiver.text).toBe('Fire 世界 🎬 é');

      await h.api('disconnect');
      const statuses = receiver.statuses;
      const displays = receiver.displays;
      if (requiresLaunch) await receiver.pauseNative();
      await h.restart();
      expect((await h.api('connect', device.id)).status).toBe('connected');
      expect(receiver.statuses).toBeGreaterThan(statuses);
      expect(receiver.displays).toBe(displays);
      expect(receiver.nativeStarts).toBe(requiresLaunch ? 2 : 0);
      expect(
        receiver.requests
          .filter((entry) => entry.path === '/v1/FireTV/status')
          .every((entry) => entry.authenticated)
      ).toBe(true);
      const credentialFiles = await readdir(path.join(h.profile, 'provider-credentials'));
      expect(
        credentialFiles.some((name) => name.startsWith('fire-tv-') && name.endsWith('.enc'))
      ).toBe(true);
      for (const name of credentialFiles) {
        expect(
          (await readFile(path.join(h.profile, 'provider-credentials', name))).includes(
            Buffer.from(receiver.token)
          )
        ).toBe(false);
      }
      await h.api('sendText', 'restored credential');
      expect(receiver.text).toBe('restored credential');
      const apple = (await h.api('bootstrap')).devices.find(
        (entry) => entry.platform === 'apple-tv'
      );
      if (!apple) throw new Error('Same-host Apple device was lost');
      const fireRequests = receiver.requests.length;
      await expect(h.api('connect', apple.id)).rejects.toThrow();
      await expect(
        h.api('sendCommand', {
          id: randomUUID(),
          command: 'up',
          issuedAt: Date.now(),
          source: 'button',
        })
      ).rejects.toThrow();
      expect(receiver.requests).toHaveLength(fireRequests);
      expect((await h.api('bootstrap')).deviceState.activeDeviceId).toBeUndefined();
      expect((await h.api('connect', device.id)).status).toBe('connected');
      await h.api('sendText', 'returned from other provider');
      expect(receiver.text).toBe('returned from other provider');
      if (requiresLaunch) {
        // Each explicit pairing/connect intent launches once, including the two failed launches.
        expect(receiver.launches).toHaveLength(receiver.displays + receiver.statuses + 2);
        for (const [index, request] of receiver.requests.entries()) {
          if (request.path === '/v1/FireTV/pin/display' || request.path === '/v1/FireTV/status') {
            expect(receiver.requests[index - 1]?.path).toBe('/apps/FireTVRemote');
          }
        }
        for (const launch of receiver.launches) {
          expect(launch.method).toBe('POST');
          expect(launch.path).toBe('/apps/FireTVRemote');
          expect(launch.body).toBe('');
          expect(launch.headers['content-type']).toBe('text/plain');
          expect(launch.headers.host).toBe(`127.0.0.1:${receiver.dialPort}`);
          for (const header of ['x-api-key', 'x-client-token', 'authorization', 'cookie']) {
            expect(launch.headers[header]).toBeUndefined();
          }
          expect(JSON.stringify(launch)).not.toContain(receiver.token);
        }
      } else {
        expect(receiver.launches).toEqual([]);
      }
      expect(receiver.errors).toEqual([]);
    } finally {
      await info.attach(`fire-${label}-wire-state`, {
        body: JSON.stringify({
          phase: receiver.phase,
          requests: receiver.requests,
          keys: receiver.keys,
          errors: receiver.errors,
        }),
        contentType: 'application/json',
      });
      await receiver.stop();
    }
  });
}

/**
 * Independent AirPlay pairing rejection receiver, not an SRP peer. M2 contains
 * correctly sized salt/public-key fields; M3 receives an authentication error.
 * No proof verification, Companion pairing or pairing success is claimed.
 */
class ApplePinReceiver {
  readonly requests: string[] = [];
  readonly errors: string[] = [];
  phase: 'idle' | 'pin-requested' | 'awaiting-pin' | 'rejected' = 'idle';
  private server?: Server;

  async start() {
    this.server = createHttpServer((request, response) => {
      void this.receive(request, response).catch((error: unknown) => {
        this.errors.push(String(error));
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    const listening = once(this.server, 'listening');
    // The published native bridge resolves an undiscovered loopback device to
    // AirPlay's default 7000; providerData does not override this library path.
    this.server.listen(7000, '127.0.0.1');
    await listening;
  }

  async stop() {
    if (!this.server?.listening) return;
    this.server.closeAllConnections();
    const closed = once(this.server, 'close');
    this.server.close();
    await closed;
  }

  private fields(body: Buffer) {
    const fields = new Map<number, Buffer>();
    for (let offset = 0; offset < body.length;) {
      if (offset + 2 > body.length) throw new Error('Truncated pairing TLV header');
      const type = body[offset++];
      const length = body[offset++];
      if (offset + length > body.length) throw new Error('Truncated pairing TLV value');
      fields.set(
        type,
        Buffer.concat([fields.get(type) ?? Buffer.alloc(0), body.subarray(offset, offset + length)])
      );
      offset += length;
    }
    return fields;
  }

  private async receive(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    this.requests.push(`${request.method} ${request.url}`);
    if (request.method !== 'POST' || request.headers['x-apple-hkp'] !== '3') {
      throw new Error('Expected native AirPlay POST with X-Apple-HKP: 3');
    }
    if (request.url === '/pair-pin-start' && body.length === 0) {
      this.phase = 'pin-requested';
      response.writeHead(200, { 'Content-Length': 0 });
      response.end();
      return;
    }
    if (request.url === '/pair-setup' && this.phase === 'pin-requested') {
      const fields = this.fields(body);
      if (
        fields.size !== 2 ||
        !fields.get(0)?.equals(Buffer.from([0])) ||
        !fields.get(6)?.equals(Buffer.from([1]))
      ) {
        throw new Error('Expected M1 method=0 and state=1');
      }
      const encoded: Buffer[] = [];
      // Independently encode TLV8, fragmenting the 384-byte public key at 255.
      for (const [type, value] of [
        [6, Buffer.from([2])],
        [2, Buffer.alloc(16, 0x11)],
        [3, Buffer.alloc(384, 0x22)],
      ] as const) {
        for (let offset = 0; offset < value.length; offset += 255) {
          const fragment = value.subarray(offset, offset + 255);
          encoded.push(Buffer.from([type, fragment.length]), fragment);
        }
      }
      const payload = Buffer.concat(encoded);
      this.phase = 'awaiting-pin';
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': payload.length,
      });
      response.end(payload);
      return;
    }
    if (request.url === '/pair-setup' && this.phase === 'awaiting-pin') {
      const fields = this.fields(body);
      if (
        fields.size !== 3 ||
        !fields.get(6)?.equals(Buffer.from([3])) ||
        fields.get(3)?.length !== 384 ||
        fields.get(4)?.length !== 64
      ) {
        throw new Error('Expected M3 state=3, 384-byte client public key and 64-byte proof');
      }
      // M4 state4 + authentication error2, encoded without the library codec.
      const payload = Buffer.from([6, 1, 4, 7, 1, 2]);
      this.phase = 'rejected';
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': payload.length,
      });
      response.end(payload);
      return;
    }
    throw new Error('Unexpected AirPlay request or receiver transition');
  }
}

test('MULTI-TV-APPLE-PIN: native PIN start ignores stale encrypted credentials and cancels', async ({
  harness: h,
}, info) => {
  const receiver = new ApplePinReceiver();
  await receiver.start();
  try {
    const devices = await h.api('saveDevice', {
      name: 'Loopback Apple PIN receiver',
      host: '127.0.0.1',
      adbPort: 5555,
      platform: 'apple-tv',
    });
    const device = devices.find((entry) => entry.platform === 'apple-tv');
    if (!device) throw new Error('Apple TV was not saved');
    const directory = path.join(h.profile, 'provider-credentials');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const credential = path.join(
      directory,
      `apple-tv-${createHash('sha256').update(device.id).digest('hex')}.enc`
    );
    const corrupt = Buffer.from('intentionally-invalid-encrypted-credential');
    await writeFile(credential, corrupt, { mode: 0o600 });
    const state = await h.api('startPairing', device.id);
    expect(state.pairing).toMatchObject({ codeLength: 4, inputPattern: '[0-9]' });
    expect(receiver.phase).toBe('awaiting-pin');
    expect(receiver.requests).toEqual(['POST /pair-pin-start', 'POST /pair-setup']);
    expect(await readFile(credential)).toEqual(corrupt);
    expect(
      (await h.api('bootstrap')).devices.find((entry) => entry.id === device.id)?.isPaired
    ).not.toBe(true);
    await h.api('disconnect');
    expect((await h.api('bootstrap')).deviceState.pairing).toBeUndefined();
    await expect(
      h.api('pair', { deviceId: device.id, host: device.host, code: '1234' })
    ).rejects.toThrow();
    expect(receiver.requests).toHaveLength(2);
    await h.api('startPairing', device.id);
    await expect(
      h.api('pair', { deviceId: device.id, host: device.host, code: '1234' })
    ).rejects.toThrow(
      /Apple TV airplay pairing failed \(bad-pin\): pairing failed; restart with \/pair <id> and enter the PIN shown on screen/
    );
    expect(receiver.phase).toBe('rejected');
    expect(receiver.requests).toHaveLength(5);
    expect((await h.api('bootstrap')).deviceState.message).toContain(
      'airplay pairing failed (bad-pin)'
    );
    expect(
      (await h.api('bootstrap')).devices.find((entry) => entry.id === device.id)?.isPaired
    ).not.toBe(true);
    expect(await readFile(credential)).toEqual(corrupt);
    expect(await readdir(directory)).toHaveLength(1);
    expect((await h.api('startPairing', device.id)).pairing?.codeLength).toBe(4);
    expect(receiver.requests).toHaveLength(7);
    await h.api('disconnect');
    expect(receiver.errors).toEqual([]);
  } finally {
    await info.attach('apple-pin-start-wire-state', {
      body: JSON.stringify({
        phase: receiver.phase,
        requests: receiver.requests,
        errors: receiver.errors,
        boundary:
          'Initial AirPlay M1/M2 and explicit M4 rejection of M3; no SRP proof verification, Companion handshake or authenticated pairing completion.',
      }),
      contentType: 'application/json',
    });
    await receiver.stop();
  }
});
