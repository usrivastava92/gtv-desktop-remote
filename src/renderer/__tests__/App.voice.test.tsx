import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapState, DeviceCapabilities, DiscoveredDevice } from '../../shared/types';
import App from '../App';
import { INITIAL_UPDATER_STATUS } from '../hooks/useUpdaterStatus';

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

async function pendingCapture() {
  const scan = deferred<DiscoveredDevice[]>();
  const capture = deferred<MediaStream>();
  let bootstrap: BootstrapState = {
    devices: [
      { id: 'one', name: 'First TV', host: '192.168.1.10', isPaired: true },
      { id: 'two', name: 'Second TV', host: '192.168.1.11', isPaired: true },
    ],
    deviceState: { status: 'connected', activeDeviceId: 'one', message: 'Connected' },
  };
  let capabilities: DeviceCapabilities = {
    textInput: true,
    powerToggle: true,
    assistantVoice: true,
  };
  const api = {
    bootstrap: vi.fn(() => Promise.resolve(bootstrap)),
    // Each IPC response has a fresh identity, even when all capabilities are unchanged.
    capabilities: vi.fn(() => Promise.resolve({ ...capabilities })),
    scanDevices: vi.fn(() => scan.promise),
    getUpdaterStatus: vi.fn().mockResolvedValue(INITIAL_UPDATER_STATUS),
    checkForUpdatesInBackground: vi.fn().mockResolvedValue(INITIAL_UPDATER_STATUS),
    onUpdaterStatus: vi.fn(() => () => undefined),
    startAssistantVoice: vi.fn().mockResolvedValue(41),
    stopAssistantVoice: vi.fn().mockResolvedValue(undefined),
    hasPendingAssistantVoiceSession: vi.fn().mockResolvedValue(true),
  };
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  const context = {
    state: 'running',
    sampleRate: 48_000,
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    createScriptProcessor: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
  };
  const getUserMedia = vi.fn(() => capture.promise);
  vi.stubGlobal('gtvRemote', api);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      return context;
    })
  );
  const view = render(<App />);
  await screen.findByRole('button', { name: /^Select$/ });
  const assistant = view.container.querySelector('.ui-media-subgrid button');
  if (!assistant) throw new Error('Assistant control was not rendered');
  fireEvent.click(assistant);
  await waitFor(() => {
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByLabelText('Assistant listening')).toBeInTheDocument();

  return {
    api,
    context,
    stopTrack,
    unmount: view.unmount,
    async finishScan(change: 'unchanged' | 'disabled' | 'device-switch' | 'disconnected') {
      if (change === 'disabled') capabilities = { ...capabilities, assistantVoice: false };
      if (change === 'device-switch') {
        bootstrap = {
          ...bootstrap,
          deviceState: { ...bootstrap.deviceState, activeDeviceId: 'two' },
        };
      }
      if (change === 'disconnected') {
        bootstrap = {
          ...bootstrap,
          deviceState: { ...bootstrap.deviceState, status: 'idle' },
        };
      }
      await act(async () => {
        scan.resolve([]);
        await scan.promise;
      });
      await waitFor(() => {
        expect(api.capabilities).toHaveBeenCalledTimes(2);
      });
    },
    async finishCapture() {
      await act(async () => {
        capture.resolve(stream);
        await capture.promise;
      });
    },
  };
}

describe('assistant capture lifecycle', () => {
  it('keeps pending native capture alive when discovery refreshes identical capabilities', async () => {
    const h = await pendingCapture();
    await h.finishScan('unchanged');
    expect(screen.getByLabelText('Assistant listening')).toBeInTheDocument();
    await h.finishCapture();
    await waitFor(() => {
      expect(h.api.startAssistantVoice).toHaveBeenCalledTimes(1);
    });
    expect(h.stopTrack).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Assistant listening')).toBeInTheDocument();
    h.unmount();
    await waitFor(() => {
      expect(h.api.stopAssistantVoice).toHaveBeenCalledWith(41);
    });
    expect(h.stopTrack).toHaveBeenCalledTimes(1);
    expect(h.context.close).toHaveBeenCalledTimes(1);
  });

  it.each(['disabled', 'device-switch', 'disconnected'] as const)(
    'cancels pending capture when voice becomes %s',
    async (change) => {
      const h = await pendingCapture();
      await h.finishScan(change);
      await h.finishCapture();
      await waitFor(() => {
        expect(h.stopTrack).toHaveBeenCalledTimes(1);
      });
      expect(h.api.startAssistantVoice).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Assistant listening')).not.toBeInTheDocument();
      h.unmount();
    }
  );

  it('releases a native stream delivered after unmount without starting a TV session', async () => {
    const h = await pendingCapture();
    await h.finishScan('unchanged');
    h.unmount();
    await h.finishCapture();
    expect(h.stopTrack).toHaveBeenCalledTimes(1);
    expect(h.api.startAssistantVoice).not.toHaveBeenCalled();
  });
});
