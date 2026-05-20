import { describe, expect, it } from 'vitest';

import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../ipcContract';

/**
 * runtime parity checks for the IPC contract.
 *
 * The TypeScript types in `ipcContract.ts` already prove every channel key
 * has a contract entry. These runtime tests catch the things types cannot:
 *   - Two keys mapped to the same channel string (silent collision).
 *   - A channel string with a typo that compiles but breaks at runtime.
 *   - Frozen-ness violations (the constants must not be mutable).
 */
describe('INVOKE_CHANNELS', () => {
  it('every channel name is unique', () => {
    const names = Object.values(INVOKE_CHANNELS);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('every channel name uses the expected format (namespace:action)', () => {
    for (const name of Object.values(INVOKE_CHANNELS)) {
      expect(name).toMatch(/^[a-z]+:[a-zA-Z]+$/);
    }
  });

  it('is frozen against mutation', () => {
    expect(Object.isFrozen(INVOKE_CHANNELS)).toBe(true);
  });

  it('contains exactly the expected channel keys', () => {
    const keys = Object.keys(INVOKE_CHANNELS).sort();
    expect(keys).toEqual(
      [
        'deviceAssistantVoiceChunk',
        'deviceAssistantVoicePending',
        'deviceAssistantVoiceStart',
        'deviceAssistantVoiceStop',
        'deviceBootstrap',
        'deviceCapabilities',
        'deviceCommand',
        'deviceConnect',
        'deviceDisconnect',
        'devicePair',
        'deviceRemove',
        'deviceReset',
        'deviceSave',
        'deviceScan',
        'deviceStartPairing',
        'deviceText',
        'metricsRendererDrop',
        'metricsSnapshot',
        'updaterCheck',
        'updaterCheckBackground',
        'updaterInstall',
        'updaterRollback',
        'updaterStatus',
      ].sort()
    );
  });
});

describe('EVENT_CHANNELS', () => {
  it('every channel name is unique', () => {
    const names = Object.values(EVENT_CHANNELS);
    expect(new Set(names).size).toBe(names.length);
  });

  it('is frozen against mutation', () => {
    expect(Object.isFrozen(EVENT_CHANNELS)).toBe(true);
  });

  it('contains the expected channel keys', () => {
    const keys = Object.keys(EVENT_CHANNELS).sort();
    expect(keys).toEqual(['updaterStatusChanged']);
  });
});

describe('INVOKE vs EVENT separation', () => {
  it('no channel name appears in both maps', () => {
    const invokeNames = new Set<string>(Object.values(INVOKE_CHANNELS));
    for (const eventName of Object.values(EVENT_CHANNELS)) {
      expect(invokeNames.has(eventName)).toBe(false);
    }
  });
});
