import { describe, expect, it } from 'vitest';

import { canSendRemoteCommand, shouldShowRemoteView } from '../src/renderer/deviceStateView';
import type { DeviceState } from '../src/shared/types';

function state(status: DeviceState['status'], activeDeviceId = 'device-1'): DeviceState {
  return {
    status,
    activeDeviceId,
    message: status,
  };
}

describe('deviceStateView', () => {
  it('enables remote commands only when the main process reports connected', () => {
    expect(canSendRemoteCommand(state('connected'), true, false)).toBe(true);

    for (const status of ['idle', 'connecting', 'reconnecting', 'lost', 'error'] as const) {
      expect(canSendRemoteCommand(state(status), true, false)).toBe(false);
    }
  });

  it('keeps the remote view visible for active lost and reconnecting states', () => {
    expect(shouldShowRemoteView(state('lost'), true, false)).toBe(true);
    expect(shouldShowRemoteView(state('reconnecting'), true, false)).toBe(true);
    expect(shouldShowRemoteView(state('error'), true, false)).toBe(true);
  });

  it('hides the remote view without an active device context', () => {
    expect(shouldShowRemoteView(state('lost'), false, false)).toBe(false);
    expect(shouldShowRemoteView(state('connected'), true, true)).toBe(false);
  });
});
