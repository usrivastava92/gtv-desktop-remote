import { promises as fs } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import type { ILogger } from '../backend/core/logger';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

function getLogPath(): string {
  return path.join(app.getPath('userData'), 'gtv-remote.log');
}

export function getAppDataPath(...segments: string[]): string {
  return path.join(app.getPath('userData'), ...segments);
}

function serializeErrorDetails(details: unknown): string {
  if (details instanceof Error) {
    return `${details.message}\n${details.stack ?? ''}`.trim();
  }

  if (typeof details === 'string') {
    return details;
  }

  return JSON.stringify(details);
}

async function write(
  level: LogLevel,
  scope: string,
  message: string,
  details?: unknown
): Promise<void> {
  const logPath = getLogPath();
  const timestamp = new Date().toISOString();
  const body = details === undefined ? '' : ` ${serializeErrorDetails(details)}`;
  const line = `[${timestamp}] [${level}] [${scope}] ${message}${body}\n`;

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, line, 'utf8');

  if (level === 'ERROR') {
    console.error(line.trim());
    return;
  }

  console.log(line.trim());
}

export async function logInfo(scope: string, message: string, details?: unknown): Promise<void> {
  await write('INFO', scope, message, details);
}

export async function logWarn(scope: string, message: string, details?: unknown): Promise<void> {
  await write('WARN', scope, message, details);
}

export async function logError(scope: string, message: string, details?: unknown): Promise<void> {
  await write('ERROR', scope, message, details);
}

export function getLoggerPath(): string {
  return getLogPath();
}

/**
 * production binding of the `ILogger` port (declared in
 * `src/backend/core/logger.ts`). Composition roots call this once and pass
 * the resulting `ILogger` into backend services so the services never have
 * to import this file directly.
 *
 * The wrappers fire-and-forget the underlying `Promise<void>` so the
 * synchronous `ILogger` contract is satisfied without forcing every backend
 * caller to write `void logger.info(...)` (the noisy ceremony that prompted
 * the post-review revision of this PR). This matches the fire-and-forget
 * behaviour every existing inline `logInfo(...)` call site already has —
 * the codebase already doesn't await most of them — so observability is
 * net-zero changed. Behavior for `await logInfo(...)` callers is also
 * unchanged because `logInfo` itself remains async-exported.
 *
 * The factory is deliberately stateless — it returns a fresh object each
 * call so multiple composition roots can each hold their own reference
 * without sharing instance state.
 */
export function createNodeLogger(): ILogger {
  return {
    info: (scope, message, details) => {
      void logInfo(scope, message, details);
    },
    warn: (scope, message, details) => {
      void logWarn(scope, message, details);
    },
    error: (scope, message, details) => {
      void logError(scope, message, details);
    },
  };
}
