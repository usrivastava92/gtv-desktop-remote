/**
 * IClock port — replaces direct `Date.now()` / `new Date()` calls so the rest
 * of the backend can be tested with a deterministic clock without resorting to
 * `vi.useFakeTimers()` (which leaks across vitest worker boundaries and has
 * bitten the metrics rate tests in the past).
 *
 * defines the port + the two canonical implementations,
 * and adopts it at the single highest-traffic call site — the metrics
 * snapshot `generatedAt` field. Future PRs migrate the other ~28 `Date.now()`
 * call sites in `src/main/metrics.ts` and the `lastActivityAt` site in
 * `src/main/device/androidTvRemote.ts` per the now-familiar seam-first pattern
 * established by the transport and updater ports.
 */

/**
 * Minimal clock interface. Two methods because both shapes appear in the
 * codebase: `Date.now()` returns a number; `new Date()` is used for ISO
 * strings (e.g. updater `lastCheckedAt`). Keeping both off a single port
 * means call sites switch types only once.
 */
export interface IClock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  /** Equivalent to `new Date(this.now())`. */
  nowDate(): Date;
}

/**
 * Production clock — directly reads the host system clock. Use this in
 * every composition root (`AppFacade` once it exists, otherwise the
 * top-level `src/main/` module that constructs the backend service).
 */
export function createSystemClock(): IClock {
  return {
    now(): number {
      return Date.now();
    },
    nowDate(): Date {
      return new Date();
    },
  };
}

/**
 * Test clock with mutable time. Tests call `advanceBy()` or `setTo()` to
 * drive the clock forward without touching real time. Crucially this is
 * *per-instance* state, so parallel vitest workers never share a clock.
 *
 * Default initial time is `0` (Unix epoch) so tests that compare timestamps
 * to one another don't have to know about wall-clock values.
 */
export function createFakeClock(initial = 0): IClock & {
  advanceBy(ms: number): void;
  setTo(ms: number): void;
} {
  let current = initial;
  return {
    now(): number {
      return current;
    },
    nowDate(): Date {
      return new Date(current);
    },
    advanceBy(ms: number): void {
      current += ms;
    },
    setTo(ms: number): void {
      current = ms;
    },
  };
}
