/**
 * AppFacade is the composition root for the backend.
 * It wires together:
 *   - DeviceRepository (src/backend/devices/deviceRepository.ts)
 *   - DeviceRegistry (src/backend/devices/deviceRegistry.ts)
 *   - VoiceSessionService (src/backend/voice/VoiceSessionService.ts)
 *   - IMetricsRecorder (src/backend/metrics/)
 * And exposes a typed surface that main.ts IPC handlers call into.
 * GoogleTvAdapter delegates to AppFacade for the logic it already owns.
 */

import path from 'node:path';

import type { SavedDevice } from '../../shared/types';
import type { IClock } from '../core/clock';
import type { IFileSystem } from '../core/fileSystem';
import type { ILogger } from '../core/logger';
import type { IMetricsRecorder } from '../metrics/IMetricsRecorder';
import type { IVoiceTransport } from '../voice/VoiceSessionService';
import { VoiceSessionService } from '../voice/VoiceSessionService';

/**
 * Minimal path provider for AppFacade to resolve the devices file.
 * In tests, this is mocked; in production, it wraps Electron's `app.getPath`.
 */
export interface IPathProvider {
  getAppDataPath(...segments: string[]): string;
}

/**
 * Simple in-memory path provider for tests.
 */
export class InMemoryPathProvider implements IPathProvider {
  constructor(private readonly basePath = '/tmp/app-data') {}

  getAppDataPath(...segments: string[]): string {
    return path.join(this.basePath, ...segments);
  }
}

export interface AppFacadeOptions {
  fileSystem: IFileSystem;
  pathProvider: IPathProvider;
  logger: ILogger;
  clock: IClock;
  metricsRecorder: IMetricsRecorder;
  voiceTransport: IVoiceTransport;
}

export class AppFacade {
  private readonly voiceSessionService: VoiceSessionService;
  private devices: SavedDevice[] = [];

  constructor(private readonly opts: AppFacadeOptions) {
    this.voiceSessionService = new VoiceSessionService(
      opts.voiceTransport,
      opts.clock,
      opts.logger
    );
  }

  // Device CRUD
  listDevices(): Promise<SavedDevice[]> {
    return Promise.resolve(this.devices);
  }

  writeDevices(devices: SavedDevice[]): Promise<void> {
    this.devices = devices;
    return Promise.resolve();
  }

  // Voice session management
  getVoiceSessionService(): VoiceSessionService {
    return this.voiceSessionService;
  }
}
