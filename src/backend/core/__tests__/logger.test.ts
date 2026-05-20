import { describe, expect, it } from 'vitest';

import { createInMemoryLogger, silentLogger, type ILogger, type LogEntry } from '../logger';

describe('ILogger — silentLogger', () => {
  /* eslint-disable no-void, @typescript-eslint/no-confusing-void-expression */
  it('is a no-op for all three levels (no throw)', () => {
    expect(() => void silentLogger.info('s', 'm', { d: 1 })).not.toThrow();
    expect(() => void silentLogger.warn('s', 'm')).not.toThrow();
    expect(() => void silentLogger.error('s', 'm', new Error('boom'))).not.toThrow();
  });
  /* eslint-enable no-void, @typescript-eslint/no-confusing-void-expression */

  it('satisfies the ILogger interface', () => {
    const logger: ILogger = silentLogger;
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});

describe('ILogger — createInMemoryLogger', () => {
  it('captures entries in call order with correct level', () => {
    const logger = createInMemoryLogger();
    void logger.info('a', 'one');
    void logger.warn('b', 'two');
    void logger.error('c', 'three');
    expect(logger.entries).toHaveLength(3);
    expect(logger.entries[0]?.level).toBe('info');
    expect(logger.entries[1]?.level).toBe('warn');
    expect(logger.entries[2]?.level).toBe('error');
  });

  it('preserves scope, message, and details', () => {
    const logger = createInMemoryLogger();
    void logger.info('androidTvCertStore', 'generated cert', { certKey: 'aa:bb' });
    expect(logger.entries[0]).toEqual<LogEntry>({
      level: 'info',
      scope: 'androidTvCertStore',
      message: 'generated cert',
      details: { certKey: 'aa:bb' },
    });
  });

  it('handles undefined details', () => {
    const logger = createInMemoryLogger();
    void logger.warn('s', 'no details');
    expect(logger.entries[0]?.details).toBeUndefined();
  });

  it('two instances are independent', () => {
    const a = createInMemoryLogger();
    const b = createInMemoryLogger();
    void a.info('a', '1');
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(0);
  });

  it('entries are read-only at the type level (compile-time gate)', () => {
    const logger = createInMemoryLogger();
    void logger.info('s', 'm');
    // The `as ReadonlyArray<LogEntry>` typing means callers cannot
    // .push() onto the result — we assert behavior only, the compile-time
    // gate is in the type signature.
    expect(Array.isArray(logger.entries)).toBe(true);
  });

  it('details can be an Error object (preserved by reference)', () => {
    const logger = createInMemoryLogger();
    const err = new Error('boom');
    void logger.error('s', 'm', err);
    expect(logger.entries[0]?.details).toBe(err);
  });
});
