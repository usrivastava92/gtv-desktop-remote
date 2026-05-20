/**
 * Pure helpers extracted from `src/main/updater.ts`
 *
 * Nothing here touches Electron, the filesystem, or the network. The full
 * updater (download / install / rollback orchestration) remains in
 * `src/main/updater.ts` for now; that big slice is the subject of a future
 * `` wave once the FSM lives on top of these pure foundations.
 *
 * **Why this matters:** the updater historically mixed pure version comparison
 * with side-effecting dialog calls and disk IO, which made it impossible to
 * unit-test the "should we offer the new version?" decision. With these helpers
 * lifted out and tested at 100%, regressions in semver comparison or rate-limit
 * formatting cannot ship without a failing CI job.
 */

/** Minimal shape used by `findBestMacAsset`. Matches the GitHub releases API. */
export interface ReleaseAssetInfo {
  readonly name: string;
}

/** Strip a leading `v`/`V` and surrounding whitespace. */
export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

/**
 * Numeric semver-ish comparator. Each version is split on `.`, each segment is
 * parsed as base-10 (non-numeric segments become 0), and segments are compared
 * pair-wise. Missing trailing segments are treated as 0 so `1.2` === `1.2.0`.
 *
 * Returns:
 *   1  if `a` > `b`
 *  -1  if `a` < `b`
 *   0  otherwise
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const aParts = normalizeVersion(a)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const bParts = normalizeVersion(b)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

  const max = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < max; i += 1) {
    const left = aParts[i] ?? 0;
    const right = bParts[i] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }

  return 0;
}

/**
 * Returns a human-friendly "in about X" string for the gap between `nowEpoch`
 * and `epochSeconds`. Boundary handling:
 *
 *   - epoch is past, NaN, or 0           → "shortly"
 *   - <= 60s away                        → "in about a minute"
 *   - < 60min away                       → "in about N minutes"
 *   - otherwise                          → "in about N hour(s)"
 *
 * `nowEpoch` is injected so tests don't need to freeze the system clock.
 */
export function formatMinutesUntil(
  epochSeconds: number,
  nowEpoch: number = Math.floor(Date.now() / 1000)
): string {
  const deltaSeconds = epochSeconds - nowEpoch;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return 'shortly';
  }

  const minutes = Math.ceil(deltaSeconds / 60);
  if (minutes <= 1) {
    return 'in about a minute';
  }
  if (minutes < 60) {
    return `in about ${String(minutes)} minutes`;
  }

  const hours = Math.ceil(minutes / 60);
  return `in about ${String(hours)} hour${hours > 1 ? 's' : ''}`;
}

/** True iff the asset ends in `.dmg` (case-sensitive — matches release naming). */
export function isDmgAsset(asset: ReleaseAssetInfo): boolean {
  return asset.name.endsWith('.dmg');
}

/**
 * Pick the best macOS asset from a release. Preference matrix:
 *
 *   1. Architecture-matched `.zip`     (e.g. `app-mac-arm64.zip` when arch=arm64)
 *   2. Any `-mac-*.zip`                (fallback for cross-arch installs)
 *   3. Architecture-matched `.dmg`
 *   4. Any `-mac-*.dmg`
 *
 * `arch` is injected (defaulting to `process.arch`) so tests can exercise both
 * x64 and arm64 selection without spawning a different process.
 *
 * Returns `undefined` if no mac asset is present.
 */
export function findBestMacAsset<T extends ReleaseAssetInfo>(
  assets: readonly T[],
  arch: string = process.arch
): T | undefined {
  const preferredZip = assets.find((asset) => asset.name.endsWith(`-mac-${arch}.zip`));
  if (preferredZip) return preferredZip;

  const anyZip = assets.find(
    (asset) => asset.name.includes('-mac-') && asset.name.endsWith('.zip')
  );
  if (anyZip) return anyZip;

  const preferredDmg = assets.find((asset) => asset.name.endsWith(`-mac-${arch}.dmg`));
  if (preferredDmg) return preferredDmg;

  return assets.find((asset) => asset.name.includes('-mac-') && isDmgAsset(asset));
}
