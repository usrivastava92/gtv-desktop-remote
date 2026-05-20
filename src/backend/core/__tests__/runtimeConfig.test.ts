import { afterEach, describe, expect, it } from 'vitest';

import {
  createNodeRuntimeConfig,
  createRuntimeConfig,
  getRuntimeConfig,
  resetRuntimeConfig,
  setRuntimeConfig,
} from '../runtimeConfig';

afterEach(() => {
  resetRuntimeConfig();
});

describe('createNodeRuntimeConfig', () => {
  it('GTV_UPDATER_DEV=1 → devUpdaterEnabled: true', () => {
    expect(createNodeRuntimeConfig({ GTV_UPDATER_DEV: '1' }).devUpdaterEnabled).toBe(true);
  });

  it('GTV_UPDATER_DEV unset → false', () => {
    expect(createNodeRuntimeConfig({}).devUpdaterEnabled).toBe(false);
  });

  it('GTV_UPDATER_DEV with any non-"1" value → false (matches existing strict check)', () => {
    for (const value of ['0', '', 'true', 'yes', 'TRUE', ' 1 ']) {
      expect(createNodeRuntimeConfig({ GTV_UPDATER_DEV: value }).devUpdaterEnabled).toBe(false);
    }
  });
});

describe('createRuntimeConfig (partial helper)', () => {
  it('defaults devUpdaterEnabled to false', () => {
    expect(createRuntimeConfig().devUpdaterEnabled).toBe(false);
    expect(createRuntimeConfig({}).devUpdaterEnabled).toBe(false);
  });

  it('respects explicit overrides', () => {
    expect(createRuntimeConfig({ devUpdaterEnabled: true }).devUpdaterEnabled).toBe(true);
    expect(createRuntimeConfig({ devUpdaterEnabled: false }).devUpdaterEnabled).toBe(false);
  });
});

describe('singleton accessor', () => {
  it('setRuntimeConfig + getRuntimeConfig round-trip', () => {
    setRuntimeConfig(createRuntimeConfig({ devUpdaterEnabled: true }));
    expect(getRuntimeConfig().devUpdaterEnabled).toBe(true);
    setRuntimeConfig(createRuntimeConfig({ devUpdaterEnabled: false }));
    expect(getRuntimeConfig().devUpdaterEnabled).toBe(false);
  });

  it('resetRuntimeConfig clears the override so the next call re-reads env', () => {
    setRuntimeConfig(createRuntimeConfig({ devUpdaterEnabled: true }));
    expect(getRuntimeConfig().devUpdaterEnabled).toBe(true);
    resetRuntimeConfig();
    expect(getRuntimeConfig()).toEqual(createNodeRuntimeConfig());
  });

  it('lazy default: getRuntimeConfig works without a prior setRuntimeConfig', () => {
    resetRuntimeConfig();
    const config = getRuntimeConfig();
    expect(typeof config.devUpdaterEnabled).toBe('boolean');
  });
});
