import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type * as FireLibrary from '@librecontrol/fire-tv' with { 'resolution-mode': 'import' };
import type { DiscoverFireTvOptions } from '@librecontrol/fire-tv' with {
  'resolution-mode': 'import',
};
import { expect, it, vi } from 'vitest';

import {
  findExistingForDraft,
  matchSavedToDiscovered,
  mergeIdentity,
  normalizeDraft,
} from '../../../src/backend/devices/deviceRegistry';
import { FireTvProvider } from '../../../src/main/device/fireTvProvider';
import type { SavedDevice } from '../../../src/shared/types';

const discovery = vi.hoisted((): { options: DiscoverFireTvOptions } => ({ options: {} }));
vi.mock('@librecontrol/fire-tv', async (importOriginal) => {
  const library = await importOriginal<typeof FireLibrary>();
  return {
    ...library,
    // Only redirect network discovery to local responders; keep native parsing,
    // endpoint co-observation and the installed dependency patch in the path.
    discoverFireTv: () => library.discoverFireTv(discovery.options),
  };
});
vi.mock('../../../src/main/metrics', () => ({ commandMetricsStore: {} }));
vi.mock('../../../src/main/device/providerCredentials', () => ({ providerCredentials: {} }));

function dnsName(name: string): Buffer {
  return Buffer.concat([
    ...name
      .split('.')
      .map((label) => Buffer.concat([Buffer.from([Buffer.byteLength(label)]), Buffer.from(label)])),
    Buffer.from([0]),
  ]);
}

function dnsRecord(name: string, type: number, data: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(1, 2);
  header.writeUInt32BE(120, 4);
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([dnsName(name), header, data]);
}

it('retains native co-observed aliases only for same-host pairing continuity', async () => {
  const mdnsId = 'den._amzn-firetv._tcp.local';
  const uuid = 'uuid:12345678-1234-1234-1234-123456789abc';
  const mdns = createSocket('udp4');
  const ssdp = createSocket('udp4');
  const descriptor = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/xml' });
    response.end(
      `<root><device><manufacturer>Amazon</manufacturer><modelName>AFTTEST</modelName><friendlyName>Den</friendlyName><UDN>${uuid}</UDN></device></root>`
    );
  });
  let advertiseSsdp = true;
  let descriptorListening = false;
  let mdnsListening = false;
  let ssdpListening = false;
  try {
    descriptor.listen(0, '127.0.0.1');
    await once(descriptor, 'listening');
    descriptorListening = true;
    mdns.bind(0, '127.0.0.1');
    await once(mdns, 'listening');
    mdnsListening = true;
    ssdp.bind(0, '127.0.0.1');
    await once(ssdp, 'listening');
    ssdpListening = true;
    const dnsHeader = Buffer.alloc(12);
    dnsHeader.writeUInt16BE(0x8400, 2);
    dnsHeader.writeUInt16BE(3, 6);
    const srv = Buffer.alloc(6);
    srv.writeUInt16BE(8080, 4);
    const announcement = Buffer.concat([
      dnsHeader,
      dnsRecord('_amzn-firetv._tcp.local', 12, dnsName(mdnsId)),
      dnsRecord(mdnsId, 33, Buffer.concat([srv, dnsName('den.local')])),
      dnsRecord('den.local', 1, Buffer.from([127, 0, 0, 1])),
    ]);
    mdns.on('message', (_query, sender) => {
      mdns.send(announcement, sender.port, sender.address);
    });
    ssdp.on('message', (_query, sender) => {
      if (!advertiseSsdp) return;
      const port = (descriptor.address() as AddressInfo).port;
      ssdp.send(
        Buffer.from(
          [
            'HTTP/1.1 200 OK',
            'ST: urn:dial-multiscreen-org:service:dial:1',
            `LOCATION: http://127.0.0.1:${String(port)}/description.xml`,
            '',
            '',
          ].join('\r\n')
        ),
        sender.port,
        sender.address
      );
    });
    discovery.options = {
      timeoutMs: 250,
      networkInterfaces: ['127.0.0.1'],
      mdnsAddress: '127.0.0.1',
      mdnsPort: mdns.address().port,
      ssdpAddress: '127.0.0.1',
      ssdpPort: ssdp.address().port,
    };
    const provider = new FireTvProvider();
    const bothResults = await provider.discover();
    expect(bothResults).toHaveLength(1);
    const both = bothResults[0];
    if (!both) throw new Error('Expected native co-observed Fire TV discovery');
    expect(both.providerData).toMatchObject({ identifier: uuid, mdnsIdentifier: mdnsId });
    const paired: SavedDevice = {
      id: 'paired-credential-key',
      name: 'Den',
      host: both.host,
      platform: 'fire-tv',
      isPaired: true,
      adbPort: 5555,
      pairingPort: 6467,
      providerData: { identifier: mdnsId },
    };
    expect(matchSavedToDiscovered(paired, bothResults)).toBe(both);
    const migrated = mergeIdentity(paired, both);
    advertiseSsdp = false;
    const mdnsResults = await provider.discover();
    expect(mdnsResults).toHaveLength(1);
    const mdnsOnly = mdnsResults[0];
    if (!mdnsOnly) throw new Error('Expected native mDNS-only Fire TV discovery');
    expect(mdnsOnly.providerData).toMatchObject({ identifier: mdnsId });
    expect(mdnsOnly.providerData?.ssdpIdentifier).toBeUndefined();
    expect(matchSavedToDiscovered(migrated, mdnsResults)).toBe(mdnsOnly);
    const draft = { ...mdnsOnly, name: 'Den', adbPort: 5555, pairingPort: 6467 };
    const existing = findExistingForDraft(draft, [migrated]);
    expect(existing).toBe(migrated);
    expect(normalizeDraft(draft, existing)).toMatchObject({
      id: paired.id,
      isPaired: true,
      providerData: { identifier: uuid, mdnsIdentifier: mdnsId, ssdpIdentifier: uuid },
    });
    expect(matchSavedToDiscovered({ ...migrated, host: '127.0.0.2' }, mdnsResults)).toBeUndefined();
    expect(matchSavedToDiscovered({ ...paired, host: '127.0.0.2' }, bothResults)).toBeUndefined();
  } finally {
    if (mdnsListening) {
      const closed = once(mdns, 'close');
      mdns.close();
      await closed;
    }
    if (ssdpListening) {
      const closed = once(ssdp, 'close');
      ssdp.close();
      await closed;
    }
    if (descriptorListening) {
      const closed = once(descriptor, 'close');
      descriptor.close();
      await closed;
    }
  }
});
