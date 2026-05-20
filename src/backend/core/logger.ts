/**
 * Logger port. Production binds this to `src/main/logger.ts`; tests inject a
 * recording fake.
 */
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
