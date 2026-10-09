import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNodeFileSystem } from '../../core/fileSystem';
import { showOnboardingOnce } from '../onboarding';

describe('first-launch onboarding', () => {
  let userData: string;
  let statePath: string;

  beforeEach(async () => {
    userData = await mkdtemp(path.join(os.tmpdir(), 'gtv-onboarding-'));
    statePath = path.join(userData, 'onboarding.json');
  });

  afterEach(async () => {
    await rm(userData, { recursive: true, force: true });
  });

  it('shows on a clean launch and persists acknowledgment across launches', async () => {
    const showHint = vi.fn().mockResolvedValue(true);
    await showOnboardingOnce(createNodeFileSystem(), statePath, showHint);
    expect(showHint).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({ acknowledged: true });

    const nextLaunchHint = vi.fn().mockResolvedValue(true);
    await showOnboardingOnce(createNodeFileSystem(), statePath, nextLaunchHint);
    expect(nextLaunchHint).not.toHaveBeenCalled();
  });

  it('does not mark the hint acknowledged while it is still open', async () => {
    let acknowledge!: (value: boolean) => void;
    let opened!: () => void;
    const hintOpened = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const dismissed = new Promise<boolean>((resolve) => {
      acknowledge = resolve;
    });
    const launch = showOnboardingOnce(createNodeFileSystem(), statePath, () => {
      opened();
      return dismissed;
    });
    await hintOpened;
    await expect(readFile(statePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    acknowledge(true);
    await launch;
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({ acknowledged: true });
  });

  it('repeats after a launch that ended without acknowledgment', async () => {
    await showOnboardingOnce(createNodeFileSystem(), statePath, () => Promise.resolve(false));
    await expect(readFile(statePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const nextLaunchHint = vi.fn().mockResolvedValue(true);
    await showOnboardingOnce(createNodeFileSystem(), statePath, nextLaunchHint);
    expect(nextLaunchHint).toHaveBeenCalledTimes(1);
  });
});
