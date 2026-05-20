import type { DiscoveredDevice, SavedDevice } from '../../shared/types';

/** A paired saved device augmented with its currently-discovered counterpart, if any. */
export interface PairedNetworkDevice {
  key: string; // 'saved:<savedDevice.id>'
  savedDevice: SavedDevice;
  discoveredDevice?: DiscoveredDevice;
}

/**
 * The picker's currently-selected entry. Discriminated union so callers
 * can switch on `kind` to know whether they're looking at a saved
 * (paired) device or a discovered (unpaired) one.
 */
export type DevicePickerSelection =
  | { kind: 'saved'; key: string; savedDevice: SavedDevice; discoveredDevice?: DiscoveredDevice }
  | { kind: 'discovered'; key: string; discoveredDevice: DiscoveredDevice };

/**
 * Find the currently-discovered counterpart of a saved device by
 * MAC-first identity. Falls back to host (the IP/hostname) so an
 * already-paired device that just moved to a new IP can still be
 * recognized as long as its MAC is in the discovery pool.
 *
 * Mirrors the priority matrix used by DeviceRegistry in the backend
 * Keeping the renderer's match logic identical to the backend's
 * is important for the Google TV non-regression gate (the same device
 * should never appear as both "paired" and "unpaired" in the picker).
 */
export function findDiscoveredForSaved(
  savedDevice: { host: string; macAddress?: string | undefined },
  discoveredDevices: readonly DiscoveredDevice[]
): DiscoveredDevice | undefined {
  if (savedDevice.macAddress) {
    const byMac = discoveredDevices.find((d) => d.macAddress === savedDevice.macAddress);
    if (byMac) return byMac;
  }
  return discoveredDevices.find((d) => d.host === savedDevice.host);
}

/**
 * Derive the list of "paired network devices" shown in the picker's
 * upper section: every saved device with isPaired=true, each augmented
 * with its (optional) discovered counterpart. Order matches the input
 * `savedDevices` filter result.
 */
export function derivePairedNetworkDevices(
  savedDevices: readonly SavedDevice[],
  discoveredDevices: readonly DiscoveredDevice[]
): PairedNetworkDevice[] {
  return savedDevices
    .filter((savedDevice) => savedDevice.isPaired)
    .map((savedDevice) => ({
      key: `saved:${savedDevice.id}`,
      savedDevice,
      discoveredDevice: findDiscoveredForSaved(savedDevice, discoveredDevices),
    }));
}

/**
 * Derive the list of "unpaired network devices" shown in the picker's
 * lower section: every discovered device that does NOT match any saved
 * device that is already paired (by host OR by MAC). Important: an
 * existing pairing wins over a fresh discovery entry — otherwise the
 * same TV would appear twice in the UI.
 */
export function deriveUnpairedNetworkDevices(
  savedDevices: readonly SavedDevice[],
  discoveredDevices: readonly DiscoveredDevice[]
): DiscoveredDevice[] {
  return discoveredDevices.filter(
    (discoveredDevice) =>
      !savedDevices.some(
        (savedDevice) =>
          savedDevice.isPaired &&
          (savedDevice.host === discoveredDevice.host ||
            (savedDevice.macAddress != null &&
              savedDevice.macAddress === discoveredDevice.macAddress))
      )
  );
}

/**
 * Resolve the picker's current `selectedDeviceKey` string against the
 * paired + unpaired buckets to produce a typed DevicePickerSelection.
 *
 * The key format is:
 *   `saved:<savedDeviceId>`      → kind: 'saved'
 *   `discovered:<discoveredId>`  → kind: 'discovered'
 *
 * Returns undefined when the key doesn't match anything (e.g. the
 * device was just removed from discovery, or the user has no selection
 * yet).
 */
export function resolveSelectedDevice(
  selectedDeviceKey: string | undefined,
  pairedNetworkDevices: readonly PairedNetworkDevice[],
  unpairedNetworkDevices: readonly DiscoveredDevice[]
): DevicePickerSelection | undefined {
  if (selectedDeviceKey == null || selectedDeviceKey === '') return undefined;

  const savedSelection = pairedNetworkDevices.find((option) => option.key === selectedDeviceKey);
  if (savedSelection) {
    return {
      kind: 'saved',
      key: savedSelection.key,
      savedDevice: savedSelection.savedDevice,
      discoveredDevice: savedSelection.discoveredDevice,
    };
  }

  const discoveredSelection = unpairedNetworkDevices.find(
    (device) => `discovered:${device.id}` === selectedDeviceKey
  );
  if (discoveredSelection) {
    return {
      kind: 'discovered',
      key: `discovered:${discoveredSelection.id}`,
      discoveredDevice: discoveredSelection,
    };
  }

  return undefined;
}
