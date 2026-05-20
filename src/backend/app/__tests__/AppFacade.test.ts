import { describe, expect, it } from 'vitest';

import type { IClock } from '../../core/clock';
import type { IFileSystem } from '../../core/fileSystem';
import { silentLogger } from '../../core/logger';
import { createSilentMetricsRecorder } from '../../metrics/IMetricsRecorder';
import type { IVoiceTransport } from '../../voice/VoiceSessionService';
import { VoiceSessionService } from '../../voice/VoiceSessionService';
import { AppFacade, InMemoryPathProvider } from '../AppFacade';

/**
 * In-memory filesystem implementation for testing.
 */
function createInMemoryFileSystem(): IFileSystem {
  const files = new Map<string, string>();

  return {
    readFile(filePath: string, _encoding: 'utf8'): Promise<string> {
      const content = files.get(filePath);
      if (content === undefined) {
        return Promise.reject(new Error(`ENOENT: no such file or directory, open '${filePath}'`));
      }
      return Promise.resolve(content);
    },
    writeFile(filePath: string, contents: string, _encoding: 'utf8'): Promise<void> {
      files.set(filePath, contents);
      return Promise.resolve();
    },
    mkdir(_dirPath: string, _options: { recursive: true }): Promise<void> {
      // no-op for in-memory filesystem
      return Promise.resolve();
    },
    rm(filePath: string, _options: { force: true }): Promise<void> {
      files.delete(filePath);
      return Promise.resolve();
    },
    rmRecursive(_target: string): Promise<void> {
      // no-op for testing
      return Promise.resolve();
    },
    rename(from: string, to: string): Promise<void> {
      const content = files.get(from);
      if (content !== undefined) {
        files.set(to, content);
        files.delete(from);
      }
      return Promise.resolve();
    },
    exists(filePath: string): Promise<boolean> {
      return Promise.resolve(files.has(filePath));
    },
  };
}

/**
 * Test clock that returns a fixed time.
 */
function createTestClock(initialTime = 1000): IClock {
  const currentTime = initialTime;
  return {
    now(): number {
      return currentTime;
    },
    nowDate(): Date {
      return new Date(currentTime);
    },
  };
}

/**
 * Minimal test implementation of IVoiceTransport.
 */
function createTestVoiceTransport(): IVoiceTransport {
  return {
    start(_host: string, _macAddress?: string): Promise<number> {
      return Promise.resolve(1);
    },
    sendChunk(
      _host: string,
      _sessionId: number,
      _chunk: Buffer,
      _macAddress?: string
    ): Promise<void> {
      // no-op
      return Promise.resolve();
    },
    stop(_host: string, _sessionId: number, _macAddress?: string): Promise<void> {
      // no-op
      return Promise.resolve();
    },
    hasPending(_host: string, _macAddress?: string): Promise<boolean> {
      return Promise.resolve(false);
    },
  };
}

describe('AppFacade', () => {
  it('can be constructed with in-memory fakes', () => {
    const fileSystem = createInMemoryFileSystem();
    const pathProvider = new InMemoryPathProvider();
    const logger = silentLogger;
    const clock = createTestClock();
    const metricsRecorder = createSilentMetricsRecorder();
    const voiceTransport = createTestVoiceTransport();

    const facade = new AppFacade({
      fileSystem,
      pathProvider,
      logger,
      clock,
      metricsRecorder,
      voiceTransport,
    });

    expect(facade).toBeDefined();
    expect(facade).toBeInstanceOf(AppFacade);
  });

  it('listDevices() returns an empty array on fresh construction', async () => {
    const facade = new AppFacade({
      fileSystem: createInMemoryFileSystem(),
      pathProvider: new InMemoryPathProvider(),
      logger: silentLogger,
      clock: createTestClock(),
      metricsRecorder: createSilentMetricsRecorder(),
      voiceTransport: createTestVoiceTransport(),
    });

    const devices = await facade.listDevices();
    expect(devices).toEqual([]);
  });

  it('writeDevices() + listDevices() round-trips correctly', async () => {
    const facade = new AppFacade({
      fileSystem: createInMemoryFileSystem(),
      pathProvider: new InMemoryPathProvider(),
      logger: silentLogger,
      clock: createTestClock(),
      metricsRecorder: createSilentMetricsRecorder(),
      voiceTransport: createTestVoiceTransport(),
    });

    const testDevices = [
      {
        id: 'device-1',
        name: 'Living Room TV',
        host: '192.168.1.100',
        macAddress: 'aa:bb:cc:dd:ee:ff',
        isConnected: false,
        model: 'Google TV',
        apiLevel: 30,
      },
      {
        id: 'device-2',
        name: 'Bedroom TV',
        host: '192.168.1.101',
        macAddress: 'aa:bb:cc:dd:ee:00',
        isConnected: false,
        model: 'Google TV',
        apiLevel: 31,
      },
    ];

    await facade.writeDevices(testDevices);
    const retrieved = await facade.listDevices();

    expect(retrieved).toEqual(testDevices);
    expect(retrieved).toHaveLength(2);
  });

  it('getVoiceSessionService() returns a VoiceSessionService instance', () => {
    const facade = new AppFacade({
      fileSystem: createInMemoryFileSystem(),
      pathProvider: new InMemoryPathProvider(),
      logger: silentLogger,
      clock: createTestClock(),
      metricsRecorder: createSilentMetricsRecorder(),
      voiceTransport: createTestVoiceTransport(),
    });

    const voiceService = facade.getVoiceSessionService();
    expect(voiceService).toBeDefined();
    expect(voiceService).toBeInstanceOf(VoiceSessionService);
  });
});
