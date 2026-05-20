/**
 * Path provider port. Production binds this to Electron's `app.getPath`;
 * tests inject a fake that returns a tmp directory. Backend services must
 * never import `electron` directly — they receive an IPathProvider.
 */
export interface IPathProvider {
  /** Where the cert store should keep PEM files. */
  getCertStateDir(): string;
  /** General-purpose: returns a path under the application's data directory. */
  getAppDataPath(...segments: string[]): string;
}
