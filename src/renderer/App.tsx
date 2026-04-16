import { useEffect, useRef, useState } from 'react';

import type {
    BootstrapState,
    DeviceDraft,
    DiscoveredDevice,
    RemoteCommand,
    SavedDevice
} from '../shared/types';

const initialDraft: DeviceDraft = {
  name: '',
  host: '',
  adbPort: 5555,
  pairingPort: 0
};

const keyboardCommandMap: Record<string, RemoteCommand> = {
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
  P: 'power'
};

const burstSensitiveCommands = new Set<RemoteCommand>(['up', 'down', 'left', 'right', 'select']);

type DevicePickerSelection =
  | { kind: 'saved'; key: string; savedDevice: SavedDevice; discoveredDevice?: DiscoveredDevice }
  | { kind: 'discovered'; key: string; discoveredDevice: DiscoveredDevice };

type IconName =
  | 'devices'
  | 'dropdown'
  | 'swap'
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
  | 'remote';

function getDesktopApi() {
  const api = window.gtvRemote;

  if (!api) {
    throw new Error('Desktop bridge unavailable. Restart the app after the Electron preload finishes compiling.');
  }

  return api;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
}

function sanitizePairCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
}

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function Icon({ name, className }: { name: IconName; className?: string }) {
  const props = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true
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
    case 'swap':
      return (
        <svg {...props}>
          <path d="M7 7H18" />
          <path d="M14.5 3.5L18 7L14.5 10.5" />
          <path d="M17 17H6" />
          <path d="M9.5 13.5L6 17L9.5 20.5" />
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
    default:
      return null;
  }
}

function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({
    devices: [],
    deviceState: {
      status: 'idle',
      message: 'Loading...'
    }
  });
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [selectedDeviceKey, setSelectedDeviceKey] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [pairingDeviceId, setPairingDeviceId] = useState('');
  const [textInput, setTextInput] = useState('');
  const [textInputOpen, setTextInputOpen] = useState(false);
  const [devicePickerOpen, setDevicePickerOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [pairingReady, setPairingReady] = useState(false);
  const pairCodeInputRef = useRef<HTMLInputElement>(null);
  const pendingCommandCountRef = useRef(0);

  const discoveredByHost = new Map(discoveredDevices.map((device) => [device.host, device]));
  const pairedNetworkDevices = bootstrap.devices.map((savedDevice) => ({
    key: `saved:${savedDevice.id}`,
    savedDevice,
    discoveredDevice: discoveredByHost.get(savedDevice.host)
  }));
  const unpairedNetworkDevices = discoveredDevices.filter(
    (discoveredDevice) => !bootstrap.devices.some((savedDevice) => savedDevice.host === discoveredDevice.host)
  );

  const selectedDevice: DevicePickerSelection | undefined = (() => {
    const savedSelection = pairedNetworkDevices.find((option) => option.key === selectedDeviceKey);
    if (savedSelection) {
      return {
        kind: 'saved',
        key: savedSelection.key,
        savedDevice: savedSelection.savedDevice,
        discoveredDevice: savedSelection.discoveredDevice
      };
    }

    const discoveredSelection = unpairedNetworkDevices.find((device) => `discovered:${device.id}` === selectedDeviceKey);
    if (discoveredSelection) {
      return {
        kind: 'discovered',
        key: `discovered:${discoveredSelection.id}`,
        discoveredDevice: discoveredSelection
      };
    }

    return undefined;
  })();

  const activeSavedDevice = bootstrap.deviceState.activeDeviceId
    ? bootstrap.devices.find((device) => device.id === bootstrap.deviceState.activeDeviceId)
    : undefined;
  const selectedSavedDevice = selectedDevice?.kind === 'saved' ? selectedDevice.savedDevice : undefined;
  const currentRemoteDevice = selectedSavedDevice ?? activeSavedDevice;
  const selectedPairedDeviceId = currentRemoteDevice?.id ?? pairingDeviceId;
  const currentRemoteDiscoveredDevice = currentRemoteDevice ? discoveredByHost.get(currentRemoteDevice.host) : undefined;
  const currentRemoteDeviceName = currentRemoteDiscoveredDevice?.name ?? currentRemoteDevice?.name;
  const selectedDeviceName = currentRemoteDeviceName
    ?? (selectedDevice?.kind === 'discovered' ? selectedDevice.discoveredDevice.name : undefined);
  const isConnected = bootstrap.deviceState.status === 'connected';
  const currentView = pairingReady ? 'pairing' : devicePickerOpen || !currentRemoteDevice ? 'devices' : 'remote';
  const bridgeDisabled = busy || !bridgeReady;
  const remoteDisabled = bridgeDisabled || !isConnected;
  const frameHeaderClassName = classes(
    'ui-header',
    currentView === 'devices' ? 'ui-header-device' : currentView === 'pairing' ? 'ui-header-pairing' : 'ui-header-remote'
  );

  async function refreshState(): Promise<BootstrapState> {
    const nextBootstrap = await getDesktopApi().bootstrap();
    setBootstrap(nextBootstrap);
    return nextBootstrap;
  }

  async function handleScanDevices(
    silent = false,
    devicesSource: SavedDevice[] = bootstrap.devices,
    activeDeviceId = bootstrap.deviceState.activeDeviceId
  ) {
    try {
      const devices = await getDesktopApi().scanDevices();
      setDiscoveredDevices(devices);
      setSelectedDeviceKey((current) => {
        const validSavedKeys = devicesSource.map((savedDevice) => `saved:${savedDevice.id}`);
        const validDiscoveredKeys = devices.map((device: DiscoveredDevice) => `discovered:${device.id}`);

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
            message: devices.length > 0 ? `Found ${devices.length} device${devices.length > 1 ? 's' : ''}.` : 'No Google TV devices found on the local network.'
          }
        }));
      }
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          message: (error as Error).message
        }
      }));
    }
  }

  useEffect(() => {
    async function initialize() {
      try {
        const nextBootstrap = await refreshState();
        setBridgeReady(true);
        setDevicePickerOpen(!nextBootstrap.deviceState.activeDeviceId);
        await handleScanDevices(true, nextBootstrap.devices, nextBootstrap.deviceState.activeDeviceId);
      } catch (error) {
        setBridgeReady(false);
        setBootstrap((current) => ({
          ...current,
          deviceState: {
            status: 'error',
            message: (error as Error).message
          }
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
    if (pairingReady) {
      pairCodeInputRef.current?.focus();
    }
  }, [pairingReady]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!bridgeReady || !isConnected) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const command = keyboardCommandMap[event.key];
      if (!command) {
        return;
      }

      event.preventDefault();
      void handleCommand(command);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bridgeReady, isConnected]);

  async function saveDiscoveredDevice(device: DiscoveredDevice): Promise<SavedDevice> {
    const devices = await getDesktopApi().saveDevice({
      name: device.name,
      host: device.host,
      adbPort: device.adbPort || initialDraft.adbPort,
      pairingPort: device.pairingPort
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
        message: `Saved ${device.name}.`
      }
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

  async function handleStartPairing(deviceId = selectedPairedDeviceId) {
    if (!deviceId) {
      return;
    }

    setBusy(true);
    try {
      await startPairingFlow(deviceId);
      await refreshState();
    } catch (error) {
      setPairingReady(false);
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          message: (error as Error).message
        }
      }));
    } finally {
      setBusy(false);
    }
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
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          message: (error as Error).message
        }
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
        code: pairCode
      });
      const nextBootstrap = await refreshState();
      setPairCode('');
      setPairingReady(false);
      setDevicePickerOpen(false);
      setSelectedDeviceKey(`saved:${device.id}`);
      await handleScanDevices(true, nextBootstrap.devices, nextBootstrap.deviceState.activeDeviceId);
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          message: (error as Error).message
        }
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
      const nextBootstrap = await refreshState();
      await handleScanDevices(true, nextBootstrap.devices, nextBootstrap.deviceState.activeDeviceId);
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          status: 'error',
          activeDeviceId: deviceId,
          message: (error as Error).message
        }
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
          message: (error as Error).message
        }
      }));
    } finally {
      setBusy(false);
    }
  }

  async function handleCommand(command: RemoteCommand) {
    if (burstSensitiveCommands.has(command) && pendingCommandCountRef.current >= 2) {
      return;
    }

    pendingCommandCountRef.current += 1;
    try {
      await getDesktopApi().sendCommand(command);
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          ...current.deviceState,
          status: 'error',
          message: (error as Error).message
        }
      }));
    } finally {
      pendingCommandCountRef.current = Math.max(0, pendingCommandCountRef.current - 1);
    }
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
          message: 'Text sent.'
        }
      }));
    } catch (error) {
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          ...current.deviceState,
          status: 'error',
          message: (error as Error).message
        }
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
          message: 'Device removed.'
        }
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

  return (
    <main className="ui-shell">
      <section className="ui-frame">
        <header className={frameHeaderClassName}>
          {currentView === 'pairing' ? (
            <>
              <div className="text-xs font-extrabold uppercase tracking-widest text-on-surface">Android TV</div>
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
              <div className="ui-header-mode">Remote</div>
              <button className="ui-icon-button ui-icon-button-accent ui-dragless justify-self-end" disabled={busy} onClick={openDevicePicker} aria-label="Open device selection">
                <Icon name="dropdown" className="h-[1.05rem] w-[1.05rem]" />
              </button>
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
                  <span>{isConnected ? 'Connected' : bootstrap.deviceState.status}</span>
                </div>
                <button className="ui-icon-button" disabled={busy} onClick={openDevicePicker} aria-label="Choose device">
                  <Icon name="dropdown" className="h-[0.92rem] w-[0.92rem]" />
                </button>
              </div>
            </>
          )}
        </header>

        {currentView === 'devices' ? (
          <div className="ui-screen-scroll">
            <section className="ui-hero">
              <h1 className="ui-title-display">Select Device</h1>
              <p className="ui-copy">Choose a screen to control or pair a new one.</p>
            </section>

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
                    const isActive = bootstrap.deviceState.activeDeviceId === option.savedDevice.id;

                    return (
                      <button
                        key={option.key}
                        className={classes('ui-card', isActive && 'ui-card-active')}
                        disabled={bridgeDisabled}
                        onClick={() => void handleSelectSavedDevice(option.savedDevice.id)}
                      >
                        <div className="ui-card-row">
                          <div className={classes('ui-avatar', isActive && 'ui-avatar-active')}>
                            <Icon name="tv" className="h-[1.2rem] w-[1.2rem]" />
                          </div>
                          <div className="ui-card-copy">
                            <div className="flex items-center justify-between gap-3">
                              <span className="ui-card-title">{displayName}</span>
                              <span className={classes('ui-badge', isActive && 'ui-badge-active')}>
                                {status}
                              </span>
                            </div>
                            <span className="ui-card-meta">{subtitle}</span>
                          </div>
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
                <button className="ui-icon-button" disabled={bridgeDisabled} onClick={() => void handleScanDevices(false)}>
                  <Icon name="refresh" className="h-5 w-5" />
                </button>
              </div>
              <div className="ui-list">
                {unpairedNetworkDevices.length === 0 ? (
                  <div className="ui-empty ui-empty-recessed">No new devices detected right now.</div>
                ) : (
                  unpairedNetworkDevices.map((device) => (
                    <button
                      key={device.id}
                      className="ui-found-row"
                      disabled={bridgeDisabled}
                      onClick={() => void handleSelectDiscoveredDevice(device)}
                    >
                      <div className="ui-found-content">
                        <div className="ui-found-main">
                          <div className="ui-found-icon">
                            <Icon name={device.source === 'googlecast' ? 'cast' : 'devices'} className="h-[1.2rem] w-[1.2rem]" />
                          </div>
                          <div>
                            <span className="block text-sm font-bold text-on-surface">{device.name}</span>
                            <span className="block text-[10px] font-medium text-on-surface-variant">{device.model ?? 'Ready to pair'}</span>
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
              <button className="ui-help-chip" disabled={bridgeDisabled} onClick={() => void handleScanDevices(false)}>
                Don&apos;t see your device?
              </button>
            </div>

            {bootstrap.deviceState.status === 'error' || !bridgeReady ? (
              <div className="ui-alert">{!bridgeReady ? 'Electron bridge not ready yet.' : bootstrap.deviceState.message}</div>
            ) : null}
          </div>
        ) : null}

        {currentView === 'pairing' ? (
          <div className="ui-pair-screen">
            <div className="ui-pair-icon">
              <Icon name="remote" className="h-8 w-8 text-primary" />
            </div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-on-surface">Enter Code</h1>
            <p className="mb-12 text-sm text-on-surface-variant">Type the 6-character pairing code displayed on your Android TV screen.</p>

            <button className="ui-code-row" disabled={busy} onClick={() => pairCodeInputRef.current?.focus()}>
              {Array.from({ length: 6 }, (_, index) => {
                const char = pairCode[index];
                const filled = Boolean(char);

                return (
                  <span key={index} className={classes('ui-code-slot', filled && 'ui-code-slot-filled')}>
                    {char ?? '_'}
                  </span>
                );
              })}
            </button>
            <input
              ref={pairCodeInputRef}
              className="sr-only-input"
              value={pairCode}
              onChange={(event) => setPairCode(sanitizePairCode(event.target.value))}
              maxLength={6}
              autoComplete="one-time-code"
            />

            <div className="ui-action-stack">
              <button className="ui-primary-button" disabled={busy || !bridgeReady || pairCode.length < 6 || !selectedPairedDeviceId} onClick={handlePair}>
                <span>Connect</span>
                <Icon name="cast" className="h-5 w-5" />
              </button>
              <button className="ui-secondary-button" disabled={busy} onClick={openDevicePicker}>
                Cancel
              </button>
            </div>
            {bootstrap.deviceState.status === 'error' ? <div className="ui-alert mt-4 w-full">{bootstrap.deviceState.message}</div> : null}
          </div>
        ) : null}

        {currentView === 'remote' ? (
          <div className="ui-remote-screen">
            <section className="ui-hero-compact">
              <div className="ui-hero-row">
                <div>
                  <span className="ui-kicker mb-1">Current Device</span>
                  <h1 className="ui-title-device">{currentRemoteDeviceName ?? 'Choose Device'}</h1>
                </div>
                <button className="ui-round-action" disabled={busy} onClick={openDevicePicker} aria-label="Switch device">
                  <Icon name="swap" className="h-5 w-5" />
                </button>
              </div>
            </section>

            {bootstrap.deviceState.status === 'error' ? (
              <div className="ui-alert mx-6 mb-3 mt-0">{bootstrap.deviceState.message}</div>
            ) : null}

            <section className="ui-dpad-wrap">
              <div className="ui-dpad">
                <button className="ui-dpad-edge ui-dpad-up" disabled={remoteDisabled} onClick={() => void handleCommand('up')}>
                  <Icon name="up" className="h-8 w-8" />
                </button>
                <button className="ui-dpad-edge ui-dpad-down" disabled={remoteDisabled} onClick={() => void handleCommand('down')}>
                  <Icon name="down" className="h-8 w-8" />
                </button>
                <button className="ui-dpad-edge ui-dpad-left" disabled={remoteDisabled} onClick={() => void handleCommand('left')}>
                  <Icon name="left" className="h-8 w-8" />
                </button>
                <button className="ui-dpad-edge ui-dpad-right" disabled={remoteDisabled} onClick={() => void handleCommand('right')}>
                  <Icon name="right" className="h-8 w-8" />
                </button>
                <button className="ui-dpad-center" disabled={remoteDisabled} onClick={() => void handleCommand('select')}>
                  Select
                </button>
              </div>
            </section>

            <section className="ui-nav-well">
              <div className="ui-nav-grid">
                <button className="ui-nav-item" disabled={remoteDisabled} onClick={() => void handleCommand('back')}>
                  <span className="ui-nav-button"><Icon name="back" className="h-6 w-6" /></span>
                  <span className="ui-nav-label">Back</span>
                </button>
                <button className="ui-nav-item" disabled={remoteDisabled} onClick={() => void handleCommand('home')}>
                  <span className="ui-nav-button ui-nav-button-active"><Icon name="home" className="h-7 w-7" /></span>
                  <span className="ui-nav-label ui-nav-label-active">Home</span>
                </button>
                <button className="ui-nav-item" disabled={remoteDisabled} onClick={() => setTextInputOpen((current) => !current)}>
                  <span className="ui-nav-button"><Icon name="keyboard" className="h-6 w-6" /></span>
                  <span className="ui-nav-label">Text</span>
                </button>
              </div>
            </section>

            {textInputOpen ? (
              <section className="ui-glass-sheet">
                <div className="ui-section-row">
                  <h2 className="ui-section-heading">Text Input</h2>
                  <button className="rounded-full px-4 py-2 text-sm text-on-surface-variant" disabled={busy} onClick={() => setTextInputOpen(false)}>
                    Close
                  </button>
                </div>
                <p className="ui-copy">Open this when your TV is focused on a text field.</p>
                <textarea className="ui-textarea" value={textInput} onChange={(event) => setTextInput(event.target.value)} placeholder="Type text to send to the TV" rows={3} />
                <button className="ui-primary-button" disabled={remoteDisabled || !textInput.trim()} onClick={handleSendText}>
                  Send Text
                </button>
              </section>
            ) : null}

            <section className="ui-media-section">
              <div className="ui-media-grid">
                <div className="ui-media-column">
                  <button className="ui-media-button ui-media-button-block" disabled={remoteDisabled} onClick={() => void handleCommand('volume_up')}>
                    <Icon name="plus" className="h-5 w-5" />
                  </button>
                  <div className="ui-media-caption">
                    <Icon name="volumeUp" className="h-4 w-4 text-on-surface-variant" />
                    <span className="ui-media-caption-label">Vol</span>
                  </div>
                  <button className="ui-media-button ui-media-button-block" disabled={remoteDisabled} onClick={() => void handleCommand('volume_down')}>
                    <Icon name="minus" className="h-5 w-5" />
                  </button>
                </div>

                <div className="ui-media-stack">
                  <button className="ui-media-button ui-media-primary" disabled={remoteDisabled} onClick={() => void handleCommand('play_pause')}>
                    <Icon name="play" className="h-8 w-8" />
                  </button>
                  <div className="ui-media-subgrid">
                    <button className="ui-media-button" disabled={remoteDisabled} onClick={() => void handleStartPairing(currentRemoteDevice?.id)}>
                      <Icon name="remote" className="h-5 w-5" />
                    </button>
                    <button className="ui-media-button ui-media-danger" disabled={remoteDisabled} onClick={() => void handleCommand('power')}>
                      <Icon name="power" className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <div className="ui-footer-actions">
              <div className="ui-chip-row">
                <button className="ui-chip" disabled={bridgeDisabled} onClick={handleDisconnect}>
                  Disconnect
                </button>
                <button className="ui-chip" disabled={bridgeDisabled} onClick={() => currentRemoteDevice && void handleRemove(currentRemoteDevice.id)}>
                  Forget
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default App;