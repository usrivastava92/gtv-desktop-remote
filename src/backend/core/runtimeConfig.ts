/**
 * `IRuntimeConfig` is a tiny port that captures runtime feature flags / env
 * overrides that production reads from `process.env` (or other ambient
 * sources) but tests need to control deterministically.
 *
 * Extracted to retire the inline
 * `process.env.GTV_UPDATER_DEV === '1'` read at module load time in
 * `src/main/updater.ts`, which made it impossible to assert behavior under
 * either dev-updater-enabled or dev-updater-disabled in a single test run.
 *
 * Adding a new flag: extend `IRuntimeConfig`, add a `process.env.*` read in
 * `createNodeRuntimeConfig()`, and update the consuming module to read via
 * `getRuntimeConfig()`. Tests can call `setRuntimeConfig(...)` to override.
 */
export interface IRuntimeConfig {
  /**
   * In development builds (`app.isPackaged === false`), the updater short-
   * circuits to a "disabled in dev" status. Setting `GTV_UPDATER_DEV=1`
   * bypasses that so dev builds can exercise the real GitHub release path
   * end-to-end.
   */
  readonly devUpdaterEnabled: boolean;
}

/** Build a config that reads from `process.env`. Used by production wiring
 * (see `src/main/main.ts`). Tests SHOULD NOT use this — they should pass a
 * literal object to `setRuntimeConfig(...)` instead. */
export function createNodeRuntimeConfig(env: NodeJS.ProcessEnv = process.env): IRuntimeConfig {
  return {
    devUpdaterEnabled: env.GTV_UPDATER_DEV === '1',
  };
}

/**
 * Build a runtime config from a partial — every missing field defaults to
 * its "production-safe disabled" value. Useful in tests that only care about
 * one flag. */
export function createRuntimeConfig(partial: Partial<IRuntimeConfig> = {}): IRuntimeConfig {
  return {
    devUpdaterEnabled: partial.devUpdaterEnabled ?? false,
  };
}

let activeConfig: IRuntimeConfig | undefined;

/** Lazily-initialized accessor. Defaults to reading `process.env` if no
 * config has been installed. */
export function getRuntimeConfig(): IRuntimeConfig {
  activeConfig ??= createNodeRuntimeConfig();
  return activeConfig;
}

/** Install a runtime config. Production calls this once at startup; tests
 * call it per-test. */
export function setRuntimeConfig(config: IRuntimeConfig): void {
  activeConfig = config;
}

/** Drop any installed config so the next `getRuntimeConfig()` re-reads from
 * `process.env`. Tests SHOULD call this in `afterEach`. */
export function resetRuntimeConfig(): void {
  activeConfig = undefined;
}
