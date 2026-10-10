import { describe, expect, it } from 'vitest';

import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../ipcContract';

/** Channel collisions would silently route consumer messages to the wrong handler. */
describe('INVOKE_CHANNELS', () => {
  it('every channel name is unique', () => {
    const names = Object.values(INVOKE_CHANNELS);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

describe('EVENT_CHANNELS', () => {
  it('every channel name is unique', () => {
    const names = Object.values(EVENT_CHANNELS);
    expect(new Set(names).size).toBe(names.length);
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
