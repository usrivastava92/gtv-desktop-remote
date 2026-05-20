import { describe, expect, it } from 'vitest';

import {
  createNodeTlsConnector,
  type ITlsConnector,
  type TlsConnectionOptions,
} from '../tlsConnector';

describe('createNodeTlsConnector', () => {
  it('returns an object satisfying the ITlsConnector contract', () => {
    const connector: ITlsConnector = createNodeTlsConnector();
    expect(typeof connector.connect).toBe('function');
  });

  it('connector function arity is 1 (takes a single options bag)', () => {
    const connector = createNodeTlsConnector();
    expect(connector.connect.length).toBe(1);
  });
});

describe('ITlsConnector contract (fake-based)', () => {
  it('a minimal fake connector satisfies the interface', () => {
    interface FakeSocketLike {
      readonly writes: TlsConnectionOptions[];
    }
    const writes: TlsConnectionOptions[] = [];
    const fake: ITlsConnector = {
      connect(options) {
        writes.push(options);
        /* eslint-disable @typescript-eslint/no-empty-function -- deliberate no-op fakes */
        const socketLike: FakeSocketLike & {
          on(): void;
          once(): void;
          setTimeout(): void;
          destroy(): void;
          write(): boolean;
          destroyed: boolean;
        } = {
          writes,
          on: () => {},
          once: () => {},
          setTimeout: () => {},
          destroy: () => {},
          write: () => true,
          destroyed: false,
        };
        /* eslint-enable @typescript-eslint/no-empty-function */
        return socketLike as unknown as ReturnType<ITlsConnector['connect']>;
      },
    };

    const result = fake.connect({
      host: '10.0.0.1',
      port: 6466,
      cert: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----',
      key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
      rejectUnauthorized: false,
    });
    expect(result).toBeDefined();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.host).toBe('10.0.0.1');
    expect(writes[0]?.port).toBe(6466);
    expect(writes[0]?.rejectUnauthorized).toBe(false);
  });
});
