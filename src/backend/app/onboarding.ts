import path from 'node:path';

import type { IFileSystem } from '../core/fileSystem';

/** Persist only a dismissed hint, so interrupted first launches can explain the app again. */
export async function showOnboardingOnce(
  fs: Pick<IFileSystem, 'readFile' | 'writeFile' | 'mkdir'>,
  statePath: string,
  showHint: () => Promise<boolean>
): Promise<void> {
  try {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
      acknowledged?: boolean;
    };
    if (state.acknowledged === true) {
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  if (await showHint()) {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify({ acknowledged: true }, null, 2), 'utf8');
  }
}
