import type { DeviceState } from '../shared/types';

export function isConnectedDeviceState(deviceState: DeviceState): boolean {
  return deviceState.status === 'connected';
}

export function canSendRemoteCommand(
  deviceState: DeviceState,
  bridgeReady: boolean,
  busy: boolean
): boolean {
  return bridgeReady && !busy && isConnectedDeviceState(deviceState);
}

export function shouldShowRemoteView(
  deviceState: DeviceState,
  hasCurrentRemoteDevice: boolean,
  devicePickerOpen: boolean
): boolean {
  return (
    hasCurrentRemoteDevice &&
    !devicePickerOpen &&
    (deviceState.status === 'connected' ||
      deviceState.status === 'connecting' ||
      deviceState.status === 'reconnecting' ||
      deviceState.status === 'lost' ||
      (deviceState.status === 'error' && Boolean(deviceState.activeDeviceId)))
  );
}
