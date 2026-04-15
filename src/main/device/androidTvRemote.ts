import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';

import { app } from 'electron';

import type { RemoteCommand } from '../../shared/types';
import { getAppDataPath, logError, logInfo } from '../logger';

type BridgeAction =
  | 'start_pairing'
  | 'finish_pairing'
  | 'connect'
  | 'disconnect'
  | 'send_command'
  | 'send_text';

interface BridgeRequest {
  id: number;
  action: BridgeAction;
  payload: Record<string, unknown>;
}

interface BridgeSuccessResponse {
  id: number;
  ok: true;
  result?: Record<string, unknown>;
}

interface BridgeErrorResponse {
  id: number;
  ok: false;
  error: string;
}

type BridgeResponse = BridgeSuccessResponse | BridgeErrorResponse;

interface PendingRequest {
  resolve: (result: Record<string, unknown> | undefined) => void;
  reject: (error: Error) => void;
}

const KEY_EVENTS: Record<RemoteCommand, string> = {
  up: 'DPAD_UP',
  down: 'DPAD_DOWN',
  left: 'DPAD_LEFT',
  right: 'DPAD_RIGHT',
  select: 'DPAD_CENTER',
  home: 'HOME',
  back: 'BACK',
  play_pause: 'MEDIA_PLAY_PAUSE',
  volume_up: 'VOLUME_UP',
  volume_down: 'VOLUME_DOWN',
  power: 'POWER'
};

class AndroidTvRemoteBridge {
  private process: ChildProcessWithoutNullStreams | undefined;

  private nextId = 1;

  private pending = new Map<number, PendingRequest>();

  private stdoutBuffer = '';

  private pythonPath = path.join(app.getAppPath(), '.venv', 'bin', 'python');

  private bridgeScriptPath = path.join(app.getAppPath(), 'python', 'androidtv_remote_bridge.py');

  private getBridgeArgs(): string[] {
    return [
      this.bridgeScriptPath,
      '--stdio',
      '--state-dir',
      getAppDataPath('androidtvremote')
    ];
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) {
      return this.process;
    }

    const pythonExecutable = this.pythonPath;
    this.process = spawn(pythonExecutable, this.getBridgeArgs(), {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk.toString();
      this.flushStdoutBuffer();
    });

    this.process.stderr.on('data', (chunk) => {
      void logInfo('androidtvremote', 'bridge stderr', chunk.toString().trim());
    });

    this.process.on('error', (error) => {
      void logError('androidtvremote', 'bridge process failed', error);
      this.rejectAllPending(new Error(`Android TV Remote bridge failed to start: ${error.message}`));
      this.process = undefined;
    });

    this.process.on('close', (code) => {
      const message = `Android TV Remote bridge exited with code ${code ?? 'unknown'}`;
      void logError('androidtvremote', message);
      this.rejectAllPending(new Error(message));
      this.process = undefined;
    });

    return this.process;
  }

  private flushStdoutBuffer(): void {
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleResponse(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleResponse(line: string): void {
    let parsed: BridgeResponse;
    try {
      parsed = JSON.parse(line) as BridgeResponse;
    } catch (error) {
      void logError('androidtvremote', 'invalid bridge response', { line, error });
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }

    this.pending.delete(parsed.id);
    if (parsed.ok) {
      pending.resolve(parsed.result);
      return;
    }

    pending.reject(new Error(parsed.error));
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private send(action: BridgeAction, payload: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const process = this.ensureStarted();
    const id = this.nextId++;
    const request: BridgeRequest = { id, action, payload };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      process.stdin.write(`${JSON.stringify(request)}\n`, 'utf8');
    });
  }

  async startPairing(host: string): Promise<Record<string, unknown> | undefined> {
    return this.send('start_pairing', { host });
  }

  async finishPairing(host: string, code: string): Promise<void> {
    await this.send('finish_pairing', { host, code });
  }

  async connect(host: string): Promise<Record<string, unknown> | undefined> {
    return this.send('connect', { host });
  }

  async disconnect(host: string): Promise<void> {
    await this.send('disconnect', { host });
  }

  async sendCommand(host: string, command: RemoteCommand): Promise<void> {
    await this.send('send_command', { host, command: KEY_EVENTS[command] });
  }

  async sendText(host: string, text: string): Promise<void> {
    await this.send('send_text', { host, text });
  }
}

export const androidTvRemoteBridge = new AndroidTvRemoteBridge();