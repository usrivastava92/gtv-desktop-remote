import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dryRun = process.argv.includes('--dry-run');

function getAppDataRoot() {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support');
    case 'win32':
      return process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    default:
      return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  }
}

function getResetTargets() {
  const appDataRoot = getAppDataRoot();
  const appNames = ['GTV Remote', 'GTV Desktop Remote'];

  return appNames.flatMap((appName) => {
    const baseDir = path.join(appDataRoot, appName);
    return [path.join(baseDir, 'devices.json'), path.join(baseDir, 'androidtvremote')];
  });
}

async function removeTarget(targetPath) {
  try {
    const stats = await fs.lstat(targetPath);
    if (dryRun) {
      console.log(`[dry-run] would remove ${targetPath}`);
      return;
    }

    await fs.rm(targetPath, {
      force: true,
      recursive: stats.isDirectory(),
    });
    console.log(`removed ${targetPath}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.log(`not found ${targetPath}`);
      return;
    }

    throw error;
  }
}

async function main() {
  console.log(`${dryRun ? 'checking' : 'resetting'} app state for gtv-desktop-remote`);
  for (const target of getResetTargets()) {
    await removeTarget(target);
  }
  console.log(dryRun ? 'dry run complete' : 'app state reset complete');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
