import { describe, expect, it } from 'vitest';

import type { ProviderDescriptor } from '../../shared/types';
import { resolveProviderIcon } from '../providerIcons';

describe('pairing provider icons', () => {
  it('looks up the selected provider rather than the first registered provider', () => {
    expect(
      resolveProviderIcon('fire-tv', [
        { id: 'google-tv', name: 'Google TV', icon: 'assistant' },
        { id: 'fire-tv', name: 'Fire TV', icon: 'fire-tv' },
      ])
    ).toBe('fire-tv');
  });

  it('uses Google metadata for historical devices without a platform', () => {
    expect(
      resolveProviderIcon(undefined, [{ id: 'google-tv', name: 'Google TV', icon: 'assistant' }])
    ).toBe('assistant');
  });

  it('uses generic artwork for missing providers or omitted icons', () => {
    expect(resolveProviderIcon('unknown-provider', [])).toBe('tv');
    expect(resolveProviderIcon('google-tv', [])).toBe('tv');
    expect(resolveProviderIcon('apple-tv', [{ id: 'apple-tv', name: 'Apple TV' }])).toBe('tv');
  });

  it('uses generic artwork for unrecognized runtime icon tokens', () => {
    const providers = [
      { id: 'custom-provider', name: 'Custom', icon: 'future-icon' },
    ] as unknown as ProviderDescriptor[];
    expect(resolveProviderIcon('custom-provider', providers)).toBe('tv');
  });
});
