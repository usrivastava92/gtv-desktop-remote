import { app } from 'electron';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DEBUG_FLAGS = new Set(['--debug', '--debug-telemetry']);

function readDebugEnvFlag(): boolean | undefined {
  const rawValue = process.env.GTV_REMOTE_DEBUG;
  if (rawValue === undefined) {
    return undefined;
  }

  return ENABLED_VALUES.has(rawValue.trim().toLowerCase());
}

function hasDebugFlag(): boolean {
  return process.argv.some((value) => DEBUG_FLAGS.has(value));
}

export function isDebugTelemetryEnabled(): boolean {
  const envEnabled = readDebugEnvFlag();
  if (envEnabled !== undefined) {
    return envEnabled;
  }

  if (!app.isPackaged) {
    return true;
  }

  return hasDebugFlag();
}