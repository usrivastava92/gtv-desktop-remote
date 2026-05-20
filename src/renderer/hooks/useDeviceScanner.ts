import { useState } from 'react';

import type { DiscoveredDevice } from '../../shared/types';
import { getDesktopApi } from '../api';

/**
 * Manages device discovery/scanning state and the scan operation.
 *
 * Returns:
 *   - discoveredDevices: list of devices found on the local network
 *   - setDiscoveredDevices: setter for discovered devices
 *   - scanning: whether a scan is currently in progress
 *   - handleScanDevices: async function to scan for devices and update discovered devices
 */
export function useDeviceScanner() {
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [scanning, setScanning] = useState(false);

  async function handleScanDevices() {
    setScanning(true);
    try {
      const devices = await getDesktopApi().scanDevices();
      setDiscoveredDevices(devices);
      return devices;
    } finally {
      setScanning(false);
    }
  }

  return { discoveredDevices, setDiscoveredDevices, scanning, handleScanDevices };
}
