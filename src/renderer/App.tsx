import { useEffect, useRef, useState } from 'react';

import { downsampleTo8kMono, toBase64 } from '../shared/audio';
import type {
  BootstrapState,
  CommandDispatchRequest,
  DeviceCapabilities,
  DeviceDraft,
  DiscoveredDevice,
  RemoteCommand,
  RemoteCommandSource,
  SavedDevice,
  UpdaterStatus,
} from '../shared/types';

// PR-renderer-1 (Wave 12): pure formatting/event helpers in lib/pure.
// PR-renderer-2 (Wave 13): pure device-selection derivers in lib/deviceSelection.
//
// Both were inline in App.tsx until extracted. Zero semantic change at
// the call sites; the helpers now live under unit tests that run in the
// jsdom + RTL harness from PR-renderer-infra.
import {
  derivePairedNetworkDevices,
  deriveUnpairedNetworkDevices,
  findDiscoveredForSaved as findDiscoveredForSavedPure,
  resolveSelectedDevice,
  type DevicePickerSelection as DevicePickerSelectionFromLib,
} from './lib/deviceSelection';
import { classes, isEditableTarget, sanitizePairCode, shouldRestartPairingFlow } from './lib/pure';

const initialDraft: DeviceDraft = {
  name: '',
  host: '',
  adbPort: 5555,
  pairingPort: 0,
};

const keyboardCommandMap: Partial<Record<string, RemoteCommand>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'select',
  Escape: 'back',
  Backspace: 'back',
  h: 'home',
  H: 'home',
  ' ': 'play_pause',
  k: 'play_pause',
  K: 'play_pause',
  '+': 'volume_up',
  '=': 'volume_up',
  '-': 'volume_down',
  _: 'volume_down',
  p: 'power',
  P: 'power',
};

const ASSISTANT_VOICE_MIN_CHUNK_BYTES = 8 * 1024;
const ASSISTANT_VOICE_INITIAL_CHUNK_BYTES = 8 * 1024;
const ASSISTANT_VOICE_STREAM_CHUNK_BYTES = 20 * 1024;

const burstSensitiveCommands = new Set<RemoteCommand>(['up', 'down', 'left', 'right', 'select']);
const MAX_QUEUED_COMMANDS = 100;

interface QueuedCommandBatch {
  command: RemoteCommand;
  source: RemoteCommandSource;
  requests: CommandDispatchRequest[];
}

// PR-renderer-2: DevicePickerSelection now lives in lib/deviceSelection
// so the resolveSelectedDevice helper can return it. Re-exported under
// the original local name to avoid touching every call site.
type DevicePickerSelection = DevicePickerSelectionFromLib;

type IconName =
  | 'devices'
  | 'dropdown'
  | 'disconnect'
  | 'trash'
  | 'tv'
  | 'cast'
  | 'refresh'
  | 'plus'
  | 'minus'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'home'
  | 'back'
  | 'keyboard'
  | 'settings'
  | 'play'
  | 'power'
  | 'volumeUp'
  | 'volumeDown'
  | 'remote'
  | 'assistant';

function getDesktopApi() {
  const api = window.gtvRemote;

  if (!api) {
    throw new Error(
      'Desktop bridge unavailable. Restart the app after the Electron preload finishes compiling.'
    );
  }

  return api;
}

// PR-renderer-1: isEditableTarget / sanitizePairCode / classes /
// shouldRestartPairingFlow moved to src/renderer/lib/pure.ts (imported at
// the top of this file). 4 pure helpers, 0 semantic change.

// PCM helpers (convertFloat32ToPcm16, downsampleTo8kMono, toBase64) moved to
// src/shared/audio.ts (QW-1) — imported at the top of this file.

function Icon({ name, className }: { name: IconName; className?: string }) {
  const props = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'devices':
      return (
        <svg {...props}>
          <rect x="3.5" y="5" width="11" height="8" rx="1.8" />
          <path d="M1.75 18.5H16.25" />
          <path d="M9 13V18.5" />
          <rect x="16.5" y="7.5" width="5.75" height="11.5" rx="1.6" />
          <circle cx="19.4" cy="16.4" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'dropdown':
      return (
        <svg {...props}>
          <path d="M6.5 9.5L12 15L17.5 9.5" />
        </svg>
      );
    case 'disconnect':
      return (
        <svg {...props}>
          <path d="M8.5 8.5L15.5 15.5" />
          <path d="M15.5 8.5L8.5 15.5" />
          <path d="M5 12C5 8.134 8.134 5 12 5" />
          <path d="M19 12C19 15.866 15.866 19 12 19" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...props}>
          <path d="M4.5 7H19.5" />
          <path d="M9.5 4.5H14.5" />
          <path d="M7 7L8 19H16L17 7" />
          <path d="M10 10V16" />
          <path d="M14 10V16" />
        </svg>
      );
    case 'tv':
      return (
        <svg {...props}>
          <rect x="4" y="5.5" width="16" height="10.5" rx="2" />
          <path d="M9 19H15" />
          <path d="M12 16.5V19" />
        </svg>
      );
    case 'cast':
      return (
        <svg {...props}>
          <path d="M4 17.5A2.5 2.5 0 0 1 6.5 20" />
          <path d="M4 12.5A7.5 7.5 0 0 1 11.5 20" />
          <path d="M4 7.5A12.5 12.5 0 0 1 16.5 20" />
          <path d="M4 5H20V19" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...props}>
          <path d="M20 11A8 8 0 0 0 6.3 5.4" />
          <path d="M6 2.5V6.5H10" />
          <path d="M4 13A8 8 0 0 0 17.7 18.6" />
          <path d="M18 21.5V17.5H14" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...props}>
          <path d="M12 5V19" />
          <path d="M5 12H19" />
        </svg>
      );
    case 'minus':
      return (
        <svg {...props}>
          <path d="M5 12H19" />
        </svg>
      );
    case 'up':
      return (
        <svg {...props}>
          <path d="M6 14L12 8L18 14" />
        </svg>
      );
    case 'down':
      return (
        <svg {...props}>
          <path d="M6 10L12 16L18 10" />
        </svg>
      );
    case 'left':
      return (
        <svg {...props}>
          <path d="M14 6L8 12L14 18" />
        </svg>
      );
    case 'right':
      return (
        <svg {...props}>
          <path d="M10 6L16 12L10 18" />
        </svg>
      );
    case 'home':
      return (
        <svg {...props}>
          <path d="M4.5 10.5L12 4L19.5 10.5" />
          <path d="M7 9.5V19H17V9.5" />
        </svg>
      );
    case 'back':
      return (
        <svg {...props}>
          <path d="M10 7L5 12L10 17" />
          <path d="M6 12H15.5C18 12 20 14 20 16.5C20 19 18 21 15.5 21" />
        </svg>
      );
    case 'keyboard':
      return (
        <svg {...props}>
          <rect x="3.5" y="6" width="17" height="12" rx="2" />
          <path d="M6.5 10H6.6" />
          <path d="M9.5 10H9.6" />
          <path d="M12.5 10H12.6" />
          <path d="M15.5 10H15.6" />
          <path d="M6.5 13H6.6" />
          <path d="M9.5 13H15.5" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.75V5" />
          <path d="M12 19V21.25" />
          <path d="M4.93 4.93L6.52 6.52" />
          <path d="M17.48 17.48L19.07 19.07" />
          <path d="M2.75 12H5" />
          <path d="M19 12H21.25" />
          <path d="M4.93 19.07L6.52 17.48" />
          <path d="M17.48 6.52L19.07 4.93" />
        </svg>
      );
    case 'play':
      return (
        <svg {...props}>
          <path d="M9 7L17 12L9 17Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'power':
      return (
        <svg {...props}>
          <path d="M12 3.5V11" />
          <path d="M7.2 6.5A6.5 6.5 0 1 0 16.8 6.5" />
        </svg>
      );
    case 'volumeUp':
      return (
        <svg {...props}>
          <path d="M5 10H8L12 6V18L8 14H5Z" />
          <path d="M15 9C16.3 10.1 16.3 13.9 15 15" />
          <path d="M17.7 6.8C20 8.7 20 15.3 17.7 17.2" />
        </svg>
      );
    case 'volumeDown':
      return (
        <svg {...props}>
          <path d="M5 10H8L12 6V18L8 14H5Z" />
          <path d="M15.8 10.2L18.2 13.8" />
          <path d="M18.2 10.2L15.8 13.8" />
        </svg>
      );
    case 'remote':
      return (
        <svg {...props}>
          <rect x="8" y="4" width="8" height="16" rx="3" />
          <path d="M7 3C9.2 1.2 14.8 1.2 17 3" />
          <path d="M5 6C8.2 3.8 15.8 3.8 19 6" />
          <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'assistant':
      return (
        <svg className={className} viewBox="0 0 28 24" fill="none" aria-hidden>
          <circle cx="8" cy="12" r="6" fill="#4285F4" />
          <circle cx="16.4" cy="10.3" r="3.9" fill="#EA4335" />
          <circle cx="16.4" cy="17" r="4.5" fill="#FBBC05" />
          <circle cx="21.5" cy="7" r="2.1" fill="#34A853" />
        </svg>
      );
    default:
      return null;
  }
}

function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({
    devices: [],
    deviceState: {
      status: 'idle',
      message: 'Loading...',
    },
  });
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [selectedDeviceKey, setSelectedDeviceKey] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [pairingDeviceId, setPairingDeviceId] = useState('');
  const [textInput, setTextInput] = useState('');
  const [textInputOpen, setTextInputOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<DeviceCapabilities>({
    textInput: false,
    powerToggle: true,
  });
  const [devicePickerOpen, setDevicePickerOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [pairingReady, setPairingReady] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<'idle' | 'active' | 'error'>('idle');
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus>({
    inProgress: false,
    stage: 'idle',
    currentVersion: 'unknown',
    message: 'Loading update status...',
    updateAvailable: false,
    updateInstallable: false,
    rollbackAvailable: false,
  });
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [dismissedRollbackVersion, setDismissedRollbackVersion] = useState<string | null>(null);
  const [suppressedRollbackVersion, setSuppressedRollbackVersion] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return window.localStorage.getItem('gtv-remote.suppressedRollbackVersion');
    } catch {
      return null;
    }
  });
  const [updaterToast, setUpdaterToast] = useState<string | null>(null);
  const pairCodeInputRef = useRef<HTMLInputElement>(null);
  const commandQueueRef = useRef<QueuedCommandBatch[]>([]);
  const queuedCommandCountRef = useRef(0);
  const isProcessingQueueRef = useRef(false);
  const assistantLongPressTimerRef = useRef<number | null>(null);
  const assistantStartingRef = useRef(false);
  const assistantActiveRef = useRef(false);
  const assistantSessionTokenRef = useRef(0);
  const assistantVoiceSessionIdRef = useRef<number | null>(null);
  const assistantAudioContextRef = useRef<AudioContext | null>(null);
  const assistantMediaStreamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const assistantProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const assistantAudioBufferRef = useRef<Uint8Array>(new Uint8Array(0));
  const assistantChunkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const assistantChunkCountRef = useRef(0);
  const assistantFirstChunkSentRef = useRef(false);

  // PR-renderer-2: replaced the inline derivation block (the Map opts
  // + findDiscoveredForSaved closure + the two array derivations + the
  // IIFE) with calls to the pure helpers in lib/deviceSelection. Same
  // shape, same identity priority matrix (MAC-first → host fallback),
  // same key format. The local `findDiscoveredForSaved` wrapper keeps
  // the in-component call sites unchanged.
  const findDiscoveredForSaved = (savedDevice: { host: string; macAddress?: string }) =>
    findDiscoveredForSavedPure(savedDevice, discoveredDevices);
  const pairedNetworkDevices = derivePairedNetworkDevices(bootstrap.devices, discoveredDevices);
  const unpairedNetworkDevices = deriveUnpairedNetworkDevices(bootstrap.devices, discoveredDevices);
  const selectedDevice: DevicePickerSelection | undefined = resolveSelectedDevice(
    selectedDeviceKey,
    pairedNetworkDevices,
    unpairedNetworkDevices
  );

  const activeSavedDevice = bootstrap.deviceState.activeDeviceId
    ? bootstrap.devices.find((device) => device.id === bootstrap.deviceState.activeDeviceId)
    : undefined;
  const selectedSavedDevice =
    selectedDevice?.kind === 'saved' ? selectedDevice.savedDevice : undefined;
  const currentRemoteDevice = selectedSavedDevice ?? activeSavedDevice;
  const selectedPairedDeviceId = currentRemoteDevice?.id ?? pairingDeviceId;
  const currentRemoteDiscoveredDevice = currentRemoteDevice
    ? findDiscoveredForSaved(currentRemoteDevice)
    : undefined;
  const currentRemoteDeviceName = currentRemoteDiscoveredDevice?.name ?? currentRemoteDevice?.name;
  const _selectedDeviceName =
    currentRemoteDeviceName ??
    (selectedDevice?.kind === 'discovered' ? selectedDevice.discoveredDevice.name : undefined);
  const isConnected = bootstrap.deviceState.status === 'connected';
  const currentView = pairingReady
    ? 'pairing'
    : !devicePickerOpen &&
        currentRemoteDevice &&
        (isConnected || bootstrap.deviceState.status === 'connecting')
      ? 'remote'
      : 'devices';
  const bridgeDisabled = busy || !bridgeReady;
  const remoteDisabled = bridgeDisabled || !isConnected;
  const frameHeaderClassName = classes(
    'ui-header',
    currentView === 'devices'
      ? 'ui-header-device'
      : currentView === 'pairing'
        ? 'ui-header-pairing'
        : 'ui-header-remote'
  );

  async function refreshState(): Promise<BootstrapState> {
    const nextBootstrap = await getDesktopApi().bootstrap();
    setBootstrap(nextBootstrap);
    return nextBootstrap;
  }

  async function refreshUpdaterStatusInBackground() {
    try {
      const nextStatus = await getDesktopApi().checkForUpdatesInBackground();
      setUpdaterStatus(nextStatus);
    } catch (error) {
      setUpdaterStatus((current) => ({
        ...current,
        inProgress: false,
        stage: 'failed',
        message: (error as Error).message || 'Update check failed.',
      }));
    }
  }

  async function handleScanDevices(
    silent = false,
    devicesSource: SavedDevice[] = bootstrap.devices,
    activeDeviceId = bootstrap.deviceState.activeDeviceId
  ) {
    setScanning(true);
    try {
      const devices = await getDesktopApi().scanDevices();
      setDiscoveredDevices(devices);
      setSelectedDeviceKey((current) => {
        const validSavedKeys = devicesSource.map((savedDevice) => `saved:${savedDevice.id}`);
        const validDiscoveredKeys = devices.map(
          (device: DiscoveredDevice) => `discovered:${device.id}`
        );

        if (validSavedKeys.includes(current) || validDiscoveredKeys.includes(current)) {
          return current;
        }

        if (activeDeviceId) {
          const activeKey = `saved:${activeDeviceId}`;
          if (validSavedKeys.includes(activeKey)) {
            return activeKey;
          }
        }

        return '';
      });

      if (!silent) {
        setBootstrap((current) => ({
          ...current,
          deviceState: {
            ...current.deviceState,
            status: current.deviceState.status === 'error' ? 'error' : current.deviceState.status,
            message:
              devices.length > 0
                ? `Found ${String(devices.length)} device${devices.length > 1 ? 's' : ''}.`
                : 'No Google TV devices found on the local network.',
          },
        }));
      }
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          message: (error as Error).message,
        },
      }));
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    async function initialize() {
      try {
        const [nextBootstrap, nextCapabilities, nextUpdaterStatus] = await Promise.all([
          refreshState(),
          getDesktopApi().capabilities(),
          getDesktopApi().getUpdaterStatus(),
        ]);
        setCapabilities(nextCapabilities);
        setUpdaterStatus(nextUpdaterStatus);
        setBridgeReady(true);
        setDevicePickerOpen(!nextBootstrap.deviceState.activeDeviceId);
        await handleScanDevices(
          true,
          nextBootstrap.devices,
          nextBootstrap.deviceState.activeDeviceId
        );
      } catch (error) {
        setBridgeReady(false);
        setBootstrap((current) => ({
          ...current,
          deviceState: {
            status: 'error',
            message: (error as Error).message,
          },
        }));
      }
    }

    void initialize();
  }, []);

  useEffect(() => {
    if (!selectedDeviceKey && activeSavedDevice) {
      setSelectedDeviceKey(`saved:${activeSavedDevice.id}`);
    }
  }, [activeSavedDevice, selectedDeviceKey]);

  useEffect(() => {
    if (!bridgeReady || currentView !== 'devices') {
      return;
    }

    void refreshUpdaterStatusInBackground();
  }, [bridgeReady, currentView]);

  useEffect(() => {
    if (!bridgeReady) {
      return;
    }

    function syncUpdaterOnForeground() {
      if (document.visibilityState !== 'visible' || currentView !== 'devices') {
        return;
      }

      void refreshUpdaterStatusInBackground();
    }

    window.addEventListener('focus', syncUpdaterOnForeground);
    document.addEventListener('visibilitychange', syncUpdaterOnForeground);

    return () => {
      window.removeEventListener('focus', syncUpdaterOnForeground);
      document.removeEventListener('visibilitychange', syncUpdaterOnForeground);
    };
  }, [bridgeReady, currentView]);

  useEffect(() => {
    if (pairingReady) {
      pairCodeInputRef.current?.focus();
    }
  }, [pairingReady]);

  function clearAssistantLongPressTimer() {
    if (assistantLongPressTimerRef.current !== null) {
      window.clearTimeout(assistantLongPressTimerRef.current);
      assistantLongPressTimerRef.current = null;
    }
  }

  async function stopAssistantSession() {
    clearAssistantLongPressTimer();
    assistantSessionTokenRef.current += 1;
    assistantStartingRef.current = false;

    if (!assistantActiveRef.current) {
      setAssistantStatus('idle');
      return;
    }

    assistantActiveRef.current = false;
    setAssistantStatus('idle');

    const sessionId = assistantVoiceSessionIdRef.current;
    assistantVoiceSessionIdRef.current = null;
    const sentChunks = assistantChunkCountRef.current;
    assistantChunkCountRef.current = 0;
    assistantFirstChunkSentRef.current = false;

    const processor = assistantProcessorRef.current;
    if (processor) {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      processor.onaudioprocess = null;
      processor.disconnect();
      assistantProcessorRef.current = null;
    }

    const stream = assistantMediaStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      assistantMediaStreamRef.current = null;
    }

    const context = assistantAudioContextRef.current;
    if (context) {
      await context.close();
      assistantAudioContextRef.current = null;
    }

    if (sessionId !== null && assistantAudioBufferRef.current.length > 0) {
      const remaining = assistantAudioBufferRef.current;
      const finalSize = Math.max(ASSISTANT_VOICE_MIN_CHUNK_BYTES, remaining.length);
      const padded = new Uint8Array(finalSize);
      padded.set(remaining.subarray(0, finalSize));
      assistantAudioBufferRef.current = new Uint8Array(0);
      assistantChunkQueueRef.current = assistantChunkQueueRef.current.then(async () => {
        await getDesktopApi().sendAssistantVoiceChunk(sessionId, toBase64(padded));
      });
    }

    if (sessionId !== null) {
      try {
        await assistantChunkQueueRef.current;
        await getDesktopApi().stopAssistantVoice(sessionId);
        setBootstrap((current) => ({
          ...current,
          deviceState: {
            ...current.deviceState,
            message: `Assistant voice sent (${String(sentChunks)} chunk${sentChunks === 1 ? '' : 's'}).`,
          },
        }));
      } catch (error) {
        setBootstrap((current) => ({
          ...current,
          deviceState: {
            ...current.deviceState,
            status: 'error',
            message: (error as Error).message,
          },
        }));
      }
    }
  }

  async function startAssistantSession() {
    if (
      assistantActiveRef.current ||
      assistantStartingRef.current ||
      remoteDisabled ||
      currentView !== 'remote'
    ) {
      return;
    }

    assistantStartingRef.current = true;
    assistantActiveRef.current = true;
    const sessionToken = assistantSessionTokenRef.current + 1;
    assistantSessionTokenRef.current = sessionToken;
    setAssistantStatus('active');

    let sessionId: number | null = null;
    try {
      sessionId = await getDesktopApi().startAssistantVoice();
      if (assistantSessionTokenRef.current !== sessionToken) {
        await getDesktopApi().stopAssistantVoice(sessionId);
        return;
      }

      assistantVoiceSessionIdRef.current = sessionId;
      assistantFirstChunkSentRef.current = false;
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (assistantSessionTokenRef.current !== sessionToken) {
        for (const track of mediaStream.getTracks()) {
          track.stop();
        }
        await getDesktopApi().stopAssistantVoice(sessionId);
        return;
      }

      assistantMediaStreamRef.current = mediaStream;

      const audioContext = new AudioContext();
      assistantAudioContextRef.current = audioContext;
      await audioContext.resume();
      if (audioContext.state !== 'running') {
        throw new Error('Microphone audio context could not start.');
      }
      const source = audioContext.createMediaStreamSource(mediaStream);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      assistantProcessorRef.current = processor;

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      processor.onaudioprocess = (event) => {
        if (!assistantActiveRef.current || assistantVoiceSessionIdRef.current === null) {
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-deprecated
        const input = event.inputBuffer.getChannelData(0);
        const downsampled = downsampleTo8kMono(input, audioContext.sampleRate);
        if (downsampled.length === 0) {
          return;
        }

        const previous = assistantAudioBufferRef.current;
        const merged = new Uint8Array(previous.length + downsampled.length);
        merged.set(previous);
        merged.set(downsampled, previous.length);
        assistantAudioBufferRef.current = merged;

        while (
          assistantAudioBufferRef.current.length >=
          (assistantFirstChunkSentRef.current
            ? ASSISTANT_VOICE_STREAM_CHUNK_BYTES
            : ASSISTANT_VOICE_INITIAL_CHUNK_BYTES)
        ) {
          const nextChunkSize = assistantFirstChunkSentRef.current
            ? ASSISTANT_VOICE_STREAM_CHUNK_BYTES
            : ASSISTANT_VOICE_INITIAL_CHUNK_BYTES;
          const chunk = assistantAudioBufferRef.current.subarray(0, nextChunkSize);
          assistantAudioBufferRef.current = assistantAudioBufferRef.current.subarray(nextChunkSize);
          const activeSessionId = assistantVoiceSessionIdRef.current;
          const payload = new Uint8Array(chunk);

          assistantChunkQueueRef.current = assistantChunkQueueRef.current.then(async () => {
            await getDesktopApi().sendAssistantVoiceChunk(activeSessionId, toBase64(payload));
            assistantChunkCountRef.current += 1;
            assistantFirstChunkSentRef.current = true;
          });
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (error) {
      assistantActiveRef.current = false;
      setAssistantStatus('error');
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          ...current.deviceState,
          status: 'error',
          message: (error as Error).message,
        },
      }));
      if (sessionId !== null && assistantVoiceSessionIdRef.current !== sessionId) {
        await getDesktopApi()
          .stopAssistantVoice(sessionId)
          .catch(() => undefined);
      }
      await stopAssistantSession();
    } finally {
      if (assistantSessionTokenRef.current === sessionToken) {
        assistantStartingRef.current = false;
      }
    }
  }

  useEffect(() => {
    if (!bridgeReady || !isConnected || currentView !== 'remote' || assistantActiveRef.current) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (assistantActiveRef.current) {
        return;
      }

      void getDesktopApi()
        .hasPendingAssistantVoiceSession()
        .then((pending) => {
          if (pending && !assistantActiveRef.current) {
            void startAssistantSession();
          }
        })
        .catch(() => {
          // Ignore polling failures and retry on next interval.
        });
    }, 300);

    return () => {
      window.clearInterval(intervalId);
    };
    // These session functions intentionally close over refs; re-running this poll on every render
    // can tear down an active microphone stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeReady, isConnected, currentView]);

  useEffect(() => {
    if (!bridgeReady || !isConnected || currentView !== 'remote') {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!assistantActiveRef.current) {
        return;
      }

      void getDesktopApi()
        .hasPendingAssistantVoiceSession()
        .then((pending) => {
          if (!pending && assistantActiveRef.current) {
            void stopAssistantSession();
          }
        })
        .catch(() => {
          // Ignore polling failures and retry on next interval.
        });
    }, 300);

    return () => {
      window.clearInterval(intervalId);
    };
    // See polling effect above; keep this tied to connection/view changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeReady, isConnected, currentView]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!bridgeReady || !isConnected || currentView !== 'remote') {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === 'Enter' && assistantActiveRef.current) {
        event.preventDefault();
        void stopAssistantSession();
        return;
      }

      if ((event.key === 'Escape' || event.key === 'Esc') && assistantActiveRef.current) {
        event.preventDefault();
        void stopAssistantSession();
        return;
      }

      if (event.key === 'g' || event.key === 'G') {
        event.preventDefault();

        if (
          event.repeat ||
          assistantLongPressTimerRef.current !== null ||
          assistantActiveRef.current
        ) {
          return;
        }

        void startAssistantSession();
        return;
      }

      if (event.key === 'v' || event.key === 'V') {
        event.preventDefault();
        if (event.repeat) {
          return;
        }

        if (assistantActiveRef.current || assistantStartingRef.current) {
          void stopAssistantSession();
        } else {
          void startAssistantSession();
        }
        return;
      }

      const command = keyboardCommandMap[event.key];
      if (!command) {
        return;
      }

      event.preventDefault();
      handleCommand(command, 'keyboard');
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== 'g' && event.key !== 'G') {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      void stopAssistantSession();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      clearAssistantLongPressTimer();
      void stopAssistantSession();
    };
    // Keyboard listeners should not be recreated for each command queue render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeReady, isConnected, currentView, remoteDisabled]);

  async function saveDiscoveredDevice(device: DiscoveredDevice): Promise<SavedDevice> {
    const devices = await getDesktopApi().saveDevice({
      name: device.name,
      host: device.host,
      adbPort: device.adbPort ?? initialDraft.adbPort,
      pairingPort: device.pairingPort,
    });
    const savedDevice = devices.find((item: SavedDevice) => item.host === device.host);

    if (!savedDevice) {
      throw new Error('Saved device could not be resolved after saving.');
    }

    setBootstrap((current) => ({
      ...current,
      devices,
      deviceState: {
        ...current.deviceState,
        status: 'idle',
        message: `Saved ${device.name}.`,
      },
    }));
    setPairingDeviceId(savedDevice.id);
    setSelectedDeviceKey(`saved:${savedDevice.id}`);
    return savedDevice;
  }

  async function startPairingFlow(deviceId: string) {
    const deviceState = await getDesktopApi().startPairing(deviceId);
    setBootstrap((current) => ({ ...current, deviceState }));
    setPairingDeviceId(deviceId);
    setPairingReady(true);
    setDevicePickerOpen(false);
  }

  async function handleSelectSavedDevice(deviceId: string) {
    setTextInputOpen(false);
    setPairCode('');
    setPairingReady(false);
    setDevicePickerOpen(false);
    setSelectedDeviceKey(`saved:${deviceId}`);
    setPairingDeviceId(deviceId);

    if (bootstrap.deviceState.activeDeviceId === deviceId && isConnected) {
      return;
    }

    await handleConnect(deviceId);
  }

  async function handleSelectDiscoveredDevice(device: DiscoveredDevice) {
    setTextInputOpen(false);
    setPairCode('');
    setDevicePickerOpen(false);
    setBusy(true);
    try {
      const savedDevice = await saveDiscoveredDevice(device);
      await startPairingFlow(savedDevice.id);
    } catch (error) {
      setPairingReady(false);
      setDevicePickerOpen(true);
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          message: (error as Error).message,
        },
      }));
    } finally {
      setBusy(false);
    }
  }

  async function handlePair() {
    if (!selectedPairedDeviceId || !pairCode.trim()) {
      return;
    }

    const device = bootstrap.devices.find((item) => item.id === selectedPairedDeviceId);
    if (!device) {
      return;
    }

    setBusy(true);
    try {
      await getDesktopApi().pair({
        deviceId: device.id,
        host: device.host,
        code: pairCode,
        macAddress: device.macAddress,
      });
      setPairCode('');
      setPairingReady(false);
      setDevicePickerOpen(false);
      setSelectedDeviceKey(`saved:${device.id}`);

      const connectingDeviceState = await getDesktopApi().connect(device.id);
      setBootstrap((current) => ({ ...current, deviceState: connectingDeviceState }));
    } catch (error) {
      const message = (error as Error).message;
      if (shouldRestartPairingFlow(message)) {
        setPairCode('');
        setPairingReady(false);
        setDevicePickerOpen(true);
      }

      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          message,
        },
      }));
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect(deviceId: string) {
    setBusy(true);
    try {
      const deviceState = await getDesktopApi().connect(deviceId);
      setBootstrap((current) => ({ ...current, deviceState }));
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          activeDeviceId: deviceId,
          message: (error as Error).message,
        },
      }));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      const deviceState = await getDesktopApi().disconnect();
      setBootstrap((current) => ({ ...current, deviceState }));
      setTextInputOpen(false);
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          ...current.deviceState,
          status: 'error',
          message: (error as Error).message,
        },
      }));
    } finally {
      setBusy(false);
    }
  }

  function createCommandRequest(
    command: RemoteCommand,
    source: RemoteCommandSource
  ): CommandDispatchRequest {
    return {
      id: crypto.randomUUID(),
      command,
      issuedAt: Date.now(),
      source,
    };
  }

  function recordQueuedCommandDrop(request: CommandDispatchRequest) {
    void getDesktopApi().recordCommandDrop({
      ...request,
      droppedAt: Date.now(),
      dropReason: 'renderer_burst_limit',
      pendingCommandCount: queuedCommandCountRef.current,
    });
  }

  function enqueueCommand(request: CommandDispatchRequest) {
    if (queuedCommandCountRef.current >= MAX_QUEUED_COMMANDS) {
      recordQueuedCommandDrop(request);
      return;
    }

    // PR-QW-renderer-strict: noUncheckedIndexedAccess makes the `[n]` access
    // already return `QueuedCommandBatch | undefined`, so the explicit `as`
    // narrowing is now redundant.
    const lastBatch = commandQueueRef.current[commandQueueRef.current.length - 1];
    if (
      lastBatch &&
      burstSensitiveCommands.has(request.command) &&
      lastBatch.command === request.command &&
      lastBatch.source === request.source
    ) {
      lastBatch.requests.push(request);
    } else {
      commandQueueRef.current.push({
        command: request.command,
        source: request.source,
        requests: [request],
      });
    }

    queuedCommandCountRef.current += 1;
    void flushQueuedCommands();
  }

  async function flushQueuedCommands() {
    if (isProcessingQueueRef.current) {
      return;
    }

    isProcessingQueueRef.current = true;

    try {
      while (commandQueueRef.current.length > 0) {
        // PR-QW-renderer-strict: noUncheckedIndexedAccess widens `[0]` to
        // include undefined. The `length > 0` guard above makes this
        // unreachable, but TS can't prove that — early-out keeps the
        // type narrowed for the rest of the loop body.
        const currentBatch = commandQueueRef.current[0];
        if (!currentBatch) {
          break;
        }
        const request = currentBatch.requests.shift();

        if (!request) {
          commandQueueRef.current.shift();
          continue;
        }

        try {
          await getDesktopApi().sendCommand(request);
        } catch (error) {
          setBootstrap((current) => ({
            ...current,
            deviceState: {
              ...current.deviceState,
              status: 'error',
              message: (error as Error).message,
            },
          }));
        } finally {
          queuedCommandCountRef.current = Math.max(0, queuedCommandCountRef.current - 1);
          if (currentBatch.requests.length === 0) {
            commandQueueRef.current.shift();
          }
        }
      }
    } finally {
      isProcessingQueueRef.current = false;
      if (commandQueueRef.current.length > 0) {
        void flushQueuedCommands();
      }
    }
  }

  function handleCommand(command: RemoteCommand, source: RemoteCommandSource = 'button') {
    const request = createCommandRequest(command, source);

    enqueueCommand(request);
  }

  async function handleSendText() {
    if (!textInput.trim()) {
      return;
    }

    setBusy(true);
    try {
      await getDesktopApi().sendText(textInput);
      setTextInput('');
      setTextInputOpen(false);
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          ...current.deviceState,
          message: 'Text sent.',
        },
      }));
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          ...current.deviceState,
          status: 'error',
          message: (error as Error).message,
        },
      }));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(deviceId: string) {
    setBusy(true);
    try {
      const devices = await getDesktopApi().removeDevice(deviceId);
      setBootstrap((current) => ({
        ...current,
        devices,
        deviceState: {
          ...current.deviceState,
          message: 'Device removed.',
        },
      }));
      setPairingDeviceId((current) => (current === deviceId ? '' : current));
      setPairingReady(false);
      setTextInputOpen(false);
      setDevicePickerOpen(true);
      setSelectedDeviceKey((current) => (current === `saved:${deviceId}` ? '' : current));
    } finally {
      setBusy(false);
    }
  }

  async function handleResetState() {
    const confirmed = window.confirm(
      'Reset the app and remove all saved devices and pairing certificates?'
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      const deviceState = await getDesktopApi().resetState();
      setBootstrap({
        devices: [],
        deviceState,
      });
      setDiscoveredDevices([]);
      setSelectedDeviceKey('');
      setPairCode('');
      setPairingDeviceId('');
      setPairingReady(false);
      setTextInput('');
      setTextInputOpen(false);
      setDevicePickerOpen(true);
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          message: (error as Error).message,
        },
      }));
    } finally {
      setBusy(false);
    }
  }

  async function handleInstallUpdate() {
    try {
      const nextStatus = await getDesktopApi().installAvailableUpdate();
      setUpdaterStatus(nextStatus);
    } catch (error) {
      setUpdaterStatus((current) => ({
        ...current,
        inProgress: false,
        stage: 'failed',
        message: (error as Error).message,
      }));
    }
  }

  async function handleRollbackUpdate() {
    try {
      const nextStatus = await getDesktopApi().rollbackToPreviousVersion();
      setUpdaterStatus(nextStatus);
    } catch (error) {
      setUpdaterStatus((current) => ({
        ...current,
        inProgress: false,
        stage: 'failed',
        message: (error as Error).message,
      }));
    }
  }

  // QW-2: subscribe to push-style updater status changes (replaces the prior
  // 1.5s setInterval polling loop). The main process broadcasts on every
  // status mutation via `updater:statusChanged`, so the renderer reacts
  // immediately and consumes zero CPU when nothing is happening.
  useEffect(() => {
    if (!bridgeReady) {
      return;
    }
    const unsubscribe = getDesktopApi().onUpdaterStatus((status) => {
      setUpdaterStatus(status);
    });
    return unsubscribe;
  }, [bridgeReady]);

  // If the rollback version actually changes (e.g. user installed a new update so a new
  // previous-version backup is now on disk), forget any prior "Don't show again" choice.
  useEffect(() => {
    const rollbackVersion = updaterStatus.rollbackVersion;
    if (!rollbackVersion) {
      return;
    }
    if (suppressedRollbackVersion && suppressedRollbackVersion !== rollbackVersion) {
      setSuppressedRollbackVersion(null);
      try {
        window.localStorage.removeItem('gtv-remote.suppressedRollbackVersion');
      } catch {
        // Ignore storage failures.
      }
    }
    if (dismissedRollbackVersion && dismissedRollbackVersion !== rollbackVersion) {
      setDismissedRollbackVersion(null);
    }
  }, [updaterStatus.rollbackVersion, suppressedRollbackVersion, dismissedRollbackVersion]);

  function openDevicePicker() {
    setTextInputOpen(false);
    setPairingReady(false);
    setPairCode('');
    setDevicePickerOpen(true);
  }

  function renderStatusLabel(savedDevice: SavedDevice, discoveredDevice?: DiscoveredDevice) {
    if (bootstrap.deviceState.activeDeviceId === savedDevice.id && isConnected) {
      return 'Connected';
    }

    if (discoveredDevice) {
      return 'Available';
    }

    return 'Offline';
  }

  function renderUpdaterPanel() {
    const isDismissed =
      updaterStatus.updateInstallable &&
      updaterStatus.latestVersion &&
      dismissedUpdateVersion === updaterStatus.latestVersion;

    if (updaterStatus.updateInstallable && !isDismissed) {
      return (
        <section className="ui-update-panel mt-4">
          <div className="ui-update-head">
            <span className="ui-card-title ui-update-title-centered">Update Available</span>
            <button
              className="ui-update-close"
              onClick={() => {
                setDismissedUpdateVersion(updaterStatus.latestVersion ?? null);
              }}
              aria-label="Close update panel"
            >
              ✕
            </button>
          </div>
          <p className="ui-copy ui-update-copy">
            {updaterStatus.currentVersion} → {updaterStatus.latestVersion}
          </p>
          {updaterStatus.inProgress ? (
            <div className="mt-2 w-full">
              <div className="ui-update-progress-track">
                <div
                  className="ui-update-progress-fill"
                  style={{ width: `${String(updaterStatus.progressPercent ?? 12)}%` }}
                />
              </div>
              <p className="ui-update-meta">
                {updaterStatus.progressPercent !== undefined
                  ? `${String(updaterStatus.progressPercent)}%`
                  : 'Updating'}
                {updaterStatus.etaSeconds !== undefined
                  ? ` • ETA ~${String(updaterStatus.etaSeconds)}s`
                  : ''}
              </p>
            </div>
          ) : null}
          <button
            className="ui-update-action"
            disabled={bridgeDisabled || updaterStatus.inProgress}
            onClick={() => {
              void handleInstallUpdate();
            }}
          >
            {updaterStatus.inProgress ? 'Updating…' : 'Update'}
          </button>
        </section>
      );
    }

    if (updaterStatus.inProgress || updaterStatus.stage === 'checking') {
      return <div className="ui-update-check mt-4">{updaterStatus.message}</div>;
    }

    const rollbackVersion = updaterStatus.rollbackVersion ?? null;
    const isRollbackDismissed =
      !!rollbackVersion &&
      (dismissedRollbackVersion === rollbackVersion ||
        suppressedRollbackVersion === rollbackVersion);

    if (updaterStatus.rollbackAvailable && rollbackVersion && !isRollbackDismissed) {
      return (
        <section className="ui-update-panel mt-4">
          <div className="ui-update-head">
            <span className="ui-card-title ui-update-title-centered">Rollback Available</span>
            <button
              className="ui-update-close"
              onClick={() => {
                setDismissedRollbackVersion(rollbackVersion);
              }}
              aria-label="Close rollback panel"
            >
              ✕
            </button>
          </div>
          <p className="ui-copy ui-update-copy">Restore previous version {rollbackVersion}</p>
          <button
            className="ui-update-action"
            disabled={bridgeDisabled}
            onClick={() => {
              void handleRollbackUpdate();
            }}
          >
            Rollback to v{rollbackVersion}
          </button>
          <button
            type="button"
            className="ui-update-secondary"
            onClick={() => {
              setSuppressedRollbackVersion(rollbackVersion);
              setDismissedRollbackVersion(rollbackVersion);
              try {
                window.localStorage.setItem(
                  'gtv-remote.suppressedRollbackVersion',
                  rollbackVersion
                );
              } catch {
                // Ignore storage failures (e.g. private mode); session dismissal still applies.
              }
            }}
          >
            Don’t show again
          </button>
        </section>
      );
    }

    return (
      <>
        <button
          className="ui-update-check mt-4"
          disabled={bridgeDisabled}
          onClick={() => {
            void getDesktopApi()
              .checkForUpdates()
              .then((nextStatus) => {
                setUpdaterStatus(nextStatus);
                if (!nextStatus.updateInstallable) {
                  setUpdaterToast(nextStatus.message || 'No updates available.');
                  window.setTimeout(() => {
                    setUpdaterToast((current) =>
                      current === (nextStatus.message || 'No updates available.') ? null : current
                    );
                  }, 2600);
                }
              })
              .catch((error: unknown) => {
                const message = (error as Error).message || 'Update check failed.';
                setUpdaterStatus((current) => ({
                  ...current,
                  inProgress: false,
                  stage: 'failed',
                  message,
                }));
                setUpdaterToast(message);
                window.setTimeout(() => {
                  setUpdaterToast((current) => (current === message ? null : current));
                }, 2600);
              });
          }}
        >
          Check for Updates
        </button>
        {updaterToast ? <div className="ui-update-toast">{updaterToast}</div> : null}
      </>
    );
  }

  const updaterPanel = renderUpdaterPanel();

  return (
    <main className="ui-shell">
      <section className="ui-frame">
        <header className={frameHeaderClassName}>
          {currentView === 'pairing' ? (
            <>
              <div className="text-xs font-extrabold uppercase tracking-widest text-on-surface">
                Android TV
              </div>
              <div className="flex items-center ui-dragless">
                <Icon name="devices" className="h-[1.15rem] w-[1.15rem] text-primary-strong" />
              </div>
            </>
          ) : currentView === 'devices' ? (
            <>
              <div className="ui-brand">
                <Icon name="devices" className="h-[1.28rem] w-[1.28rem] text-primary-strong" />
                <span className="ui-brand-label ui-brand-label-muted">Android TV</span>
              </div>
            </>
          ) : (
            <>
              <div className="ui-brand">
                <Icon name="devices" className="h-[1.28rem] w-[1.28rem] text-primary-strong" />
                <span className="ui-brand-label">Android TV</span>
              </div>
              <div className="flex min-w-0 items-center gap-3 ui-dragless">
                <div
                  className={classes(
                    'ui-status-pill',
                    bootstrap.deviceState.status === 'error' && 'ui-status-pill-error'
                  )}
                >
                  <span className="ui-status-dot" />
                  <span className="ui-pill-text">
                    {isConnected ? 'Connected' : bootstrap.deviceState.status}
                  </span>
                </div>
              </div>
            </>
          )}
        </header>

        {currentView === 'devices' ? (
          <div className="ui-screen-scroll">
            <div className="ui-devices-content">
              <section className="ui-section">
                <div className="ui-section-row">
                  <h2 className="ui-section-heading">Known Devices</h2>
                  <span className="ui-live-dot" />
                </div>
                <div className="ui-list">
                  {pairedNetworkDevices.length === 0 ? (
                    <div className="ui-empty">No paired devices yet.</div>
                  ) : (
                    pairedNetworkDevices.map((option) => {
                      const status = renderStatusLabel(option.savedDevice, option.discoveredDevice);
                      const displayName = option.discoveredDevice?.name ?? option.savedDevice.name;
                      const subtitle = option.discoveredDevice?.model ?? option.savedDevice.host;
                      const isActive =
                        bootstrap.deviceState.activeDeviceId === option.savedDevice.id;

                      return (
                        <button
                          key={option.key}
                          className={classes('ui-card', isActive && 'ui-card-active')}
                          disabled={bridgeDisabled}
                          onClick={() => {
                            void handleSelectSavedDevice(option.savedDevice.id);
                          }}
                        >
                          <div className="ui-card-row">
                            <div className={classes('ui-avatar', isActive && 'ui-avatar-active')}>
                              <Icon name="tv" className="h-[1.2rem] w-[1.2rem]" />
                            </div>
                            <div className="ui-card-copy">
                              <span className="ui-card-title">{displayName}</span>
                              <span className="ui-card-meta">{subtitle}</span>
                            </div>
                            <span className={classes('ui-badge', isActive && 'ui-badge-active')}>
                              <span className="ui-pill-text">{status}</span>
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="ui-section">
                <div className="ui-section-row">
                  <h2 className="ui-section-heading">New Devices Found</h2>
                  <button
                    className="ui-icon-button"
                    disabled={bridgeDisabled || scanning}
                    onClick={() => {
                      void handleScanDevices(false);
                    }}
                  >
                    <Icon
                      name="refresh"
                      className={`h-5 w-5 ${scanning ? 'animate-spin' : ''}`}
                    />{' '}
                  </button>
                </div>
                <div className="ui-list">
                  {unpairedNetworkDevices.length === 0 ? (
                    <div className="ui-empty ui-empty-recessed">
                      No new devices detected right now.
                    </div>
                  ) : (
                    unpairedNetworkDevices.map((device) => (
                      <button
                        key={device.id}
                        className="ui-found-row"
                        disabled={bridgeDisabled}
                        onClick={() => {
                          void handleSelectDiscoveredDevice(device);
                        }}
                      >
                        <div className="ui-found-content">
                          <div className="ui-found-main">
                            <div className="ui-found-icon">
                              <Icon
                                name={device.source === 'googlecast' ? 'cast' : 'devices'}
                                className="h-[1.2rem] w-[1.2rem]"
                              />
                            </div>
                            <div>
                              <span className="block text-sm font-bold text-on-surface">
                                {device.name}
                              </span>
                              <span className="block text-[10px] font-medium text-on-surface-variant">
                                {device.model ?? 'Ready to pair'}
                              </span>
                            </div>
                          </div>
                          <div className="ui-found-add">
                            <Icon name="plus" className="h-4 w-4" />
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <div className="ui-help">
                <button
                  className="ui-help-chip"
                  disabled={bridgeDisabled}
                  onClick={() => {
                    void handleScanDevices(false);
                  }}
                >
                  Don&apos;t see your device?
                </button>
                <button
                  className="ui-help-chip ui-help-chip-danger"
                  disabled={bridgeDisabled}
                  onClick={() => {
                    void handleResetState();
                  }}
                >
                  Reset App State
                </button>
              </div>
            </div>

            <div className="ui-devices-footer">{updaterPanel}</div>

            {bootstrap.deviceState.status === 'error' || !bridgeReady ? (
              <div className="ui-alert">
                {!bridgeReady ? 'Electron bridge not ready yet.' : bootstrap.deviceState.message}
              </div>
            ) : null}
          </div>
        ) : null}

        {currentView === 'pairing' ? (
          <div className="ui-pair-screen">
            <div className="ui-pair-icon">
              <Icon name="assistant" className="h-8 w-8 text-primary" />
            </div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-on-surface">Enter Code</h1>
            <p className="mb-12 text-sm text-on-surface-variant">
              Type the 6-character pairing code displayed on your Android TV screen.
            </p>

            <button
              className="ui-code-row"
              disabled={busy}
              onClick={() => pairCodeInputRef.current?.focus()}
            >
              {Array.from({ length: 6 }, (_, index) => {
                const char = pairCode[index];
                const filled = Boolean(char);

                return (
                  <span
                    key={index}
                    className={classes('ui-code-slot', filled && 'ui-code-slot-filled')}
                  >
                    {char ?? '_'}
                  </span>
                );
              })}
            </button>
            <input
              ref={pairCodeInputRef}
              className="sr-only-input"
              value={pairCode}
              onChange={(event) => {
                setPairCode(sanitizePairCode(event.target.value));
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && pairCode.length === 6 && !busy) {
                  void handlePair();
                }
              }}
              maxLength={6}
              autoComplete="one-time-code"
            />

            <div className="ui-action-stack">
              <button
                className="ui-primary-button"
                disabled={busy || !bridgeReady || pairCode.length < 6 || !selectedPairedDeviceId}
                onClick={() => {
                  void handlePair();
                }}
              >
                <span>Connect</span>
                <Icon name="cast" className="h-5 w-5" />
              </button>
              <button className="ui-secondary-button" disabled={busy} onClick={openDevicePicker}>
                Cancel
              </button>
            </div>
            {bootstrap.deviceState.status === 'error' ? (
              <div className="ui-alert mt-4 w-full">{bootstrap.deviceState.message}</div>
            ) : null}
          </div>
        ) : null}

        {currentView === 'remote' ? (
          <div className="ui-remote-screen">
            <section className="ui-remote-summary">
              <div className="ui-status-pill">
                <span>{currentRemoteDeviceName ?? 'Choose Device'}</span>
              </div>
            </section>

            {bootstrap.deviceState.status === 'error' ? (
              <div className="ui-alert mx-6 mb-3 mt-0">{bootstrap.deviceState.message}</div>
            ) : null}

            <section className="ui-dpad-wrap">
              <div className="ui-dpad">
                <button
                  className="ui-dpad-edge ui-dpad-up"
                  disabled={remoteDisabled}
                  onClick={() => {
                    handleCommand('up');
                  }}
                >
                  <Icon name="up" className="h-7 w-7" />
                </button>
                <button
                  className="ui-dpad-edge ui-dpad-down"
                  disabled={remoteDisabled}
                  onClick={() => {
                    handleCommand('down');
                  }}
                >
                  <Icon name="down" className="h-7 w-7" />
                </button>
                <button
                  className="ui-dpad-edge ui-dpad-left"
                  disabled={remoteDisabled}
                  onClick={() => {
                    handleCommand('left');
                  }}
                >
                  <Icon name="left" className="h-7 w-7" />
                </button>
                <button
                  className="ui-dpad-edge ui-dpad-right"
                  disabled={remoteDisabled}
                  onClick={() => {
                    handleCommand('right');
                  }}
                >
                  <Icon name="right" className="h-7 w-7" />
                </button>
                <button
                  className="ui-dpad-center"
                  disabled={remoteDisabled}
                  onClick={() => {
                    handleCommand('select');
                  }}
                >
                  Select
                </button>
              </div>
            </section>

            {assistantStatus === 'active' ? (
              <div className="ui-assistant-wave" aria-label="Assistant listening">
                <span className="ui-assistant-dot ui-assistant-dot-blue" />
                <span className="ui-assistant-dot ui-assistant-dot-red" />
                <span className="ui-assistant-dot ui-assistant-dot-yellow" />
                <span className="ui-assistant-dot ui-assistant-dot-green" />
              </div>
            ) : null}

            <section className="ui-nav-well">
              <div className="ui-nav-grid">
                <button
                  className="ui-nav-item"
                  disabled={remoteDisabled}
                  onClick={() => {
                    handleCommand('back');
                  }}
                >
                  <span className="ui-nav-button">
                    <Icon name="back" className="h-6 w-6" />
                  </span>
                  <span className="ui-nav-label">Back</span>
                </button>
                <button
                  className="ui-nav-item"
                  disabled={remoteDisabled}
                  onClick={() => {
                    handleCommand('home');
                  }}
                >
                  <span className="ui-nav-button ui-nav-button-active">
                    <Icon name="home" className="h-7 w-7" />
                  </span>
                  <span className="ui-nav-label ui-nav-label-active">Home</span>
                </button>
                {capabilities.textInput ? (
                  <button
                    className="ui-nav-item"
                    disabled={remoteDisabled}
                    onClick={() => {
                      setTextInputOpen((current) => !current);
                    }}
                  >
                    <span className="ui-nav-button">
                      <Icon name="keyboard" className="h-6 w-6" />
                    </span>
                    <span className="ui-nav-label">Text</span>
                  </button>
                ) : null}
              </div>
            </section>

            {textInputOpen && capabilities.textInput ? (
              <section className="ui-glass-sheet">
                <div className="ui-section-row">
                  <h2 className="ui-section-heading">Text Input</h2>
                  <button
                    className="rounded-full px-4 py-2 text-sm text-on-surface-variant"
                    disabled={busy}
                    onClick={() => {
                      setTextInputOpen(false);
                    }}
                  >
                    Close
                  </button>
                </div>
                <p className="ui-copy">Open this when your TV is focused on a text field.</p>
                <textarea
                  className="ui-textarea"
                  value={textInput}
                  onChange={(event) => {
                    setTextInput(event.target.value);
                  }}
                  placeholder="Type text to send to the TV"
                  rows={3}
                />
                <button
                  className="ui-primary-button"
                  disabled={remoteDisabled || !textInput.trim()}
                  onClick={() => {
                    void handleSendText();
                  }}
                >
                  Send Text
                </button>
              </section>
            ) : null}

            <section className="ui-media-section">
              <div className="ui-media-grid">
                <div className="ui-media-column">
                  <button
                    className="ui-media-button ui-media-button-block"
                    disabled={remoteDisabled}
                    onClick={() => {
                      handleCommand('volume_up');
                    }}
                  >
                    <Icon name="plus" className="h-5 w-5" />
                  </button>
                  <div className="ui-media-caption">
                    <Icon name="volumeUp" className="h-4 w-4 text-on-surface-variant" />
                    <span className="ui-media-caption-label">Vol</span>
                  </div>
                  <button
                    className="ui-media-button ui-media-button-block"
                    disabled={remoteDisabled}
                    onClick={() => {
                      handleCommand('volume_down');
                    }}
                  >
                    <Icon name="minus" className="h-5 w-5" />
                  </button>
                </div>

                <div className="ui-media-stack">
                  <button
                    className="ui-media-button ui-media-primary"
                    disabled={remoteDisabled}
                    onClick={() => {
                      handleCommand('play_pause');
                    }}
                  >
                    <Icon name="play" className="h-8 w-8" />
                  </button>
                  <div className="ui-media-subgrid">
                    <button
                      className={classes(
                        'ui-media-button',
                        assistantStatus === 'active' && 'ui-media-button-assistant-active'
                      )}
                      disabled={remoteDisabled}
                      onClick={() => {
                        if (assistantActiveRef.current || assistantStartingRef.current) {
                          void stopAssistantSession();
                        } else {
                          void startAssistantSession();
                        }
                      }}
                    >
                      <Icon name="assistant" className="h-10 w-10" />
                    </button>
                    <button
                      className="ui-media-button ui-media-danger"
                      disabled={remoteDisabled}
                      onClick={() => {
                        handleCommand('power');
                      }}
                    >
                      <Icon name="power" className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <footer className="ui-footer-bar">
              <button className="ui-footer-item" disabled={busy} onClick={openDevicePicker}>
                <Icon name="back" className="h-5 w-5" />
                <span className="ui-footer-label">Devices</span>
              </button>
              <button
                className="ui-footer-item"
                disabled={bridgeDisabled}
                onClick={() => {
                  void handleDisconnect();
                }}
              >
                <Icon name="disconnect" className="h-5 w-5" />
                <span className="ui-footer-label">Disconnect</span>
              </button>
              <button
                className="ui-footer-item"
                disabled={bridgeDisabled || !currentRemoteDevice}
                onClick={() => {
                  if (currentRemoteDevice) {
                    void handleRemove(currentRemoteDevice.id);
                  }
                }}
              >
                <Icon name="trash" className="h-5 w-5" />
                <span className="ui-footer-label">Forget</span>
              </button>
            </footer>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default App;
