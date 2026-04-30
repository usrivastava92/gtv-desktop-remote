import { promises as fs } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

type LogLevel = 'INFO' | 'ERROR';

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

export async function logError(scope: string, message: string, details?: unknown): Promise<void> {
  await write('ERROR', scope, message, details);
}

export function getLoggerPath(): string {
  return getLogPath();
}
