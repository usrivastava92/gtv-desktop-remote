/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { BootstrapState, PairingStep } from '../../shared/types';
import { usePairingFlow } from '../hooks/usePairingFlow';

const pinStep: PairingStep = {
  instructions: 'Enter the AirPlay PIN',
  codeLength: 4,
  inputPattern: '[0-9]',
};

function state(pairing?: PairingStep): BootstrapState {
  return {
    devices: [],
    deviceState: {
      status: 'idle',
      activeDeviceId: 'apple-1',
      message: 'Pairing',
      ...(pairing ? { pairing } : {}),
    },
  };
}

describe('provider pairing progression', () => {
  it('keeps Apple pairing open after the first PIN and closes only after the second', async () => {
    const secondStep = { ...pinStep, instructions: 'Enter the companion PIN' };
    const api = {
      pair: vi.fn(() => Promise.resolve()),
      bootstrap: vi.fn().mockResolvedValueOnce(state(secondStep)).mockResolvedValueOnce(state()),
    };
    const { result } = renderHook(() => usePairingFlow());
    act(() => {
      result.current.setPairingReady(true);
      result.current.setPairCode('0123');
    });
    await act(async () => {
      const next = await result.current.submitPairCode(api, {
        deviceId: 'apple-1',
        host: '192.168.1.10',
        code: '0123',
      });
      expect(next.deviceState.pairing).toEqual(secondStep);
    });
    expect(result.current.pairingReady).toBe(true);
    expect(result.current.pairCode).toBe('');
    await act(async () => {
      await result.current.submitPairCode(api, {
        deviceId: 'apple-1',
        host: '192.168.1.10',
        code: '4567',
      });
    });
    expect(result.current.pairingReady).toBe(false);
    expect(api.pair).toHaveBeenCalledTimes(2);
    expect(api.bootstrap).toHaveBeenCalledTimes(2);
  });

  it('retains the current pairing input and stage when submission fails', async () => {
    const api = {
      pair: vi.fn().mockRejectedValue(new Error('Incorrect PIN')),
      bootstrap: vi.fn(),
    };
    const { result } = renderHook(() => usePairingFlow());
    act(() => {
      result.current.setPairingReady(true);
      result.current.setPairCode('0123');
    });
    await act(async () => {
      await expect(
        result.current.submitPairCode(api, {
          deviceId: 'apple-1',
          host: '192.168.1.10',
          code: '0123',
        })
      ).rejects.toThrow('Incorrect PIN');
    });
    expect(result.current.pairingReady).toBe(true);
    expect(result.current.pairCode).toBe('0123');
    expect(api.bootstrap).not.toHaveBeenCalled();
  });
});
