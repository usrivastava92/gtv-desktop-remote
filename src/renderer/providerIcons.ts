import type { DevicePlatform, ProviderDescriptor, ProviderIcon } from '../shared/types';

export function resolveProviderIcon(
  platform: DevicePlatform | undefined,
  providers: readonly ProviderDescriptor[] = []
): ProviderIcon {
  const icon = providers.find((provider) => provider.id === (platform ?? 'google-tv'))?.icon;
  switch (icon) {
    case 'assistant':
    case 'apple':
    case 'fire-tv':
      return icon;
    default:
      return 'tv';
  }
}
