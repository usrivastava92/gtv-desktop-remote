import { describe, expect, it } from 'vitest';

import { createInMemoryLogger, silentLogger, type ILogger, type LogEntry } from '../logger';

describe('ILogger — silentLogger', () => {
  it('is a no-op for all three levels (no throw)', () => {
    expect(() => {
      silentLogger.info('s', 'm', { d: 1 });
    }).not.toThrow();
    expect(() => {
      silentLogger.warn('s', 'm');
    }).not.toThrow();
    expect(() => {
      silentLogger.error('s', 'm', new Error('boom'));
    }).not.toThrow();
  });

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
    logger.info('a', 'one');
    logger.warn('b', 'two');
    logger.error('c', 'three');
    expect(logger.entries).toHaveLength(3);
    expect(logger.entries[0]?.level).toBe('info');
    expect(logger.entries[1]?.level).toBe('warn');
    expect(logger.entries[2]?.level).toBe('error');
  });

  it('preserves scope, message, and details', () => {
    const logger = createInMemoryLogger();
    logger.info('androidTvCertStore', 'generated cert', { certKey: 'aa:bb' });
    expect(logger.entries[0]).toEqual<LogEntry>({
      level: 'info',
      scope: 'androidTvCertStore',
      message: 'generated cert',
      details: { certKey: 'aa:bb' },
    });
  });

  it('handles undefined details', () => {
    const logger = createInMemoryLogger();
    logger.warn('s', 'no details');
    expect(logger.entries[0]?.details).toBeUndefined();
  });

  it('two instances are independent', () => {
    const a = createInMemoryLogger();
    const b = createInMemoryLogger();
    a.info('a', '1');
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(0);
  });

  it('entries are read-only at the type level (compile-time gate)', () => {
    const logger = createInMemoryLogger();
    logger.info('s', 'm');
    // The `as ReadonlyArray<LogEntry>` typing means callers cannot
    // .push() onto the result — we assert behavior only, the compile-time
    // gate is in the type signature.
    expect(Array.isArray(logger.entries)).toBe(true);
  });

  it('details can be an Error object (preserved by reference)', () => {
    const logger = createInMemoryLogger();
    const err = new Error('boom');
    logger.error('s', 'm', err);
    expect(logger.entries[0]?.details).toBe(err);
  });
});
