/**
 * Logger port. Production binds this to `src/main/logger.ts` via
 * `createNodeLogger()`; tests inject either `silentLogger` (the
 * swallow-everything default) or `createInMemoryLogger()` (the recording
 * factory below) to assert on what was written.
 *
 * PR-3a introduced the port. PR-QW-logger (Wave 8) adds:
 *   - level field to LogEntry for in-memory tests
 *   - createInMemoryLogger() factory that captures entries in call order
 *   - Note: `createNodeLogger()` lives in src/main/logger.ts so the backend
 *     layer never imports electron transitively.
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface ILogger {
  info(scope: string, message: string, details?: unknown): Promise<void> | void;
  warn(scope: string, message: string, details?: unknown): Promise<void> | void;
  error(scope: string, message: string, details?: unknown): Promise<void> | void;
}

/** A logger that swallows everything — safe default for unit tests. */
export const silentLogger: ILogger = {
  info() {
    /* no-op */
  },
  warn() {
    /* no-op */
  },
  error() {
    /* no-op */
  },
};

/**
 * Recording logger for unit tests. Returns an `ILogger` that captures every
 * call into `entries` in call order. Tests then assert on the resulting
 * array. Each instance is independent — no shared module state.
 *
 * Usage:
 *   const logger = createInMemoryLogger();
 *   subject.doThing(logger);
 *   expect(logger.entries).toEqual([
 *     { level: 'info', scope: 'subject', message: '...', details: { ... } },
 *   ]);
 */
export function createInMemoryLogger(): ILogger & { readonly entries: readonly LogEntry[] } {
  const entries: LogEntry[] = [];
  const push = (level: LogLevel, scope: string, message: string, details?: unknown): void => {
    // Note: we keep details as-is (no clone) so tests can use referential
    // equality checks. Tests that mutate details after logging should clone
    // explicitly themselves.
    entries.push({ level, scope, message, details });
  };
  return {
    get entries(): readonly LogEntry[] {
      return entries;
    },
    info(scope, message, details) {
      push('info', scope, message, details);
    },
    warn(scope, message, details) {
      push('warn', scope, message, details);
    },
    error(scope, message, details) {
      push('error', scope, message, details);
    },
  };
}
