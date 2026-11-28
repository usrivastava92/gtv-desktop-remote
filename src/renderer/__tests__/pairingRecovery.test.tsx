/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapState, DiscoveredDevice, SavedDevice } from '../../shared/types';
import App from '../App';
import { INITIAL_UPDATER_STATUS } from '../hooks/useUpdaterStatus';

const device: DiscoveredDevice = {
  id: 'fire-tv:one',
  platform: 'fire-tv',
  name: 'Bedroom Fire TV',
  host: '192.168.1.10',
  source: 'fire-tv',
  providerData: { identifier: 'one' },
};
const saved: SavedDevice = { ...device, id: 'saved-fire', isPaired: false };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pairing timeout recovery', () => {
  it.each([false, true])(
    'preserves the timeout and allows a fresh discovery attempt (recovery bootstrap fails: %s)',
    async (bootstrapFails) => {
      let failed = false;
      let bootstrap: BootstrapState = {
        devices: [],
        deviceState: { status: 'idle', message: 'Ready' },
      };
      const api = {
        bootstrap: vi.fn(() => {
          if (failed && bootstrapFails) {
            return Promise.reject(new Error('Recovery bridge unavailable'));
          }
          return Promise.resolve(bootstrap);
        }),
        capabilities: vi.fn().mockResolvedValue({
          textInput: true,
          powerToggle: false,
          assistantVoice: false,
        }),
        scanDevices: vi.fn().mockResolvedValue([device]),
        getUpdaterStatus: vi.fn().mockResolvedValue(INITIAL_UPDATER_STATUS),
        checkForUpdatesInBackground: vi.fn().mockResolvedValue(INITIAL_UPDATER_STATUS),
        onUpdaterStatus: vi.fn(() => () => undefined),
        saveDevice: vi.fn(() => {
          failed = false;
          bootstrap = { ...bootstrap, devices: [saved] };
          return Promise.resolve([saved]);
        }),
        startPairing: vi.fn(() => {
          bootstrap = {
            devices: [saved],
            deviceState: {
              status: 'idle',
              activeDeviceId: saved.id,
              message: 'Enter PIN',
              pairing: { instructions: 'Enter Fire TV PIN', codeLength: 4, inputPattern: '[0-9]' },
            },
          };
          return Promise.resolve(bootstrap.deviceState);
        }),
        pair: vi.fn(() => {
          failed = true;
          bootstrap = {
            devices: [saved],
            deviceState: { status: 'error', message: 'Fire TV request timed out' },
          };
          return Promise.reject(new Error('Fire TV request timed out'));
        }),
        connect: vi.fn(),
      };
      vi.stubGlobal('gtvRemote', api);
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Bedroom Fire TV/ }));
      const input = await screen.findByLabelText('Pairing code');
      fireEvent.change(input, { target: { value: '1234' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => {
        expect(api.pair).toHaveBeenCalledTimes(1);
      });
      expect(await screen.findByText('Fire TV request timed out')).toBeInTheDocument();
      expect(screen.queryByText('Recovery bridge unavailable')).not.toBeInTheDocument();
      expect(api.connect).not.toHaveBeenCalled();
      if (!bootstrapFails) {
        await waitFor(() => {
          expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /Bedroom Fire TV/ }));
        await screen.findByLabelText('Pairing code');
        expect(api.startPairing).toHaveBeenCalledTimes(2);
      } else {
        expect(screen.getByLabelText('Pairing code')).toHaveValue('1234');
      }
    }
  );
});
