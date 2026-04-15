import { useEffect, useState } from 'react';

import type {
    BootstrapState,
    DeviceDraft,
    DiscoveredDevice,
    RemoteCommand,
    SavedDevice
} from '../shared/types';

const remoteLayout: Array<Array<{ label: string; command: RemoteCommand; accent?: boolean }>> = [
  [{ label: 'Power', command: 'power' }],
  [{ label: 'Up', command: 'up' }],
  [
    { label: 'Left', command: 'left' },
    { label: 'Select', command: 'select', accent: true },
    { label: 'Right', command: 'right' }
  ],
  [{ label: 'Down', command: 'down' }],
  [
    { label: 'Home', command: 'home' },
    { label: 'Back', command: 'back' },
    { label: 'Play/Pause', command: 'play_pause' }
  ],
  [
    { label: 'Vol +', command: 'volume_up' },
    { label: 'Vol -', command: 'volume_down' }
  ]
];

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

const initialDraft: DeviceDraft = {
  name: '',
  host: '',
  adbPort: 5555,
  pairingPort: 0
};

type DevicePickerSelection =
  | { kind: 'saved'; key: string; savedDevice: SavedDevice; discoveredDevice: DiscoveredDevice }
  | { kind: 'discovered'; key: string; discoveredDevice: DiscoveredDevice };

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
  const [scanning, setScanning] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairingDeviceId, setPairingDeviceId] = useState('');
  const [textInput, setTextInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [pairingReady, setPairingReady] = useState(false);

  const discoveredByHost = new Map(discoveredDevices.map((device) => [device.host, device]));
  const pairedNetworkDevices = bootstrap.devices
    .map((savedDevice) => {
      const discoveredDevice = discoveredByHost.get(savedDevice.host);
      if (!discoveredDevice) {
        return null;
      }

      return {
        key: `saved:${savedDevice.id}`,
        savedDevice,
        discoveredDevice
      };
    })
    .filter((entry): entry is { key: string; savedDevice: SavedDevice; discoveredDevice: DiscoveredDevice } => entry !== null);
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

  const selectedSavedDevice = selectedDevice?.kind === 'saved' ? selectedDevice.savedDevice : undefined;
  const selectedPairedDeviceId = selectedSavedDevice?.id ?? pairingDeviceId;
  const isSelectedDeviceActive = selectedSavedDevice ? bootstrap.deviceState.activeDeviceId === selectedSavedDevice.id : false;
  const primaryActionLabel = (() => {
    if (!selectedDevice) {
      return 'Choose Device';
    }

    if (selectedDevice.kind === 'saved') {
      return isSelectedDeviceActive ? 'Reconnect Device' : 'Connect Device';
    }

    return 'Pair Device';
  })();
  const pickerHelpText = (() => {
    if (!selectedDevice) {
      return 'Choose a scanned Google TV to connect or pair.';
    }

    if (selectedDevice.kind === 'saved') {
      return `${selectedDevice.savedDevice.name} is already paired and available on the network.`;
    }

    return `${selectedDevice.discoveredDevice.name} is available on the network and needs pairing.`;
  })();

  async function refreshState() {
    const nextBootstrap = await getDesktopApi().bootstrap();
    setBootstrap(nextBootstrap);
  }

  async function handleScanDevices(silent = false) {
    setScanning(true);
    try {
      const devices = await getDesktopApi().scanDevices();
      setDiscoveredDevices(devices);
      setSelectedDeviceKey((current) => {
        const validSavedKeys = bootstrap.devices
          .filter((savedDevice) => devices.some((device: DiscoveredDevice) => device.host === savedDevice.host))
          .map((savedDevice) => `saved:${savedDevice.id}`);
        const validDiscoveredKeys = devices.map((device: DiscoveredDevice) => `discovered:${device.id}`);

        if (validSavedKeys.includes(current) || validDiscoveredKeys.includes(current)) {
          return current;
        }

        return validSavedKeys[0] ?? validDiscoveredKeys[0] ?? '';
      });

      if (!silent) {
        setBootstrap((current) => ({
          ...current,
          deviceState: {
            ...current.deviceState,
            status: 'idle',
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
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    async function initialize() {
      try {
        await refreshState();
        setBridgeReady(true);
        await handleScanDevices(true);
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
    function onKeyDown(event: KeyboardEvent) {
      if (busy || !bridgeReady || bootstrap.deviceState.status !== 'connected') {
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
  }, [bootstrap.deviceState.status, bridgeReady, busy]);

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
    setPairingReady(false);
    return savedDevice;
  }

  async function startPairingFlow(deviceId: string) {
    const deviceState = await getDesktopApi().startPairing(deviceId);
    setBootstrap((current) => ({ ...current, deviceState }));
    setPairingDeviceId(deviceId);
    setPairingReady(true);
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

  async function handleChooseDevice() {
    if (!selectedDevice) {
      return;
    }

    if (selectedDevice.kind === 'saved') {
      await handleConnect(selectedDevice.savedDevice.id);
      return;
    }

    setBusy(true);
    try {
      const savedDevice = await saveDiscoveredDevice(selectedDevice.discoveredDevice);
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
      await refreshState();
      setPairCode('');
      setPairingReady(false);
      setSelectedDeviceKey(`saved:${device.id}`);
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
      await refreshState();
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
    setBusy(true);
    try {
      await getDesktopApi().sendCommand(command);
      setBootstrap((current) => ({
        ...current,
        deviceState: {
          ...current.deviceState,
          message: `Sent ${command.replace('_', ' ')}.`
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

  async function handleSendText() {
    if (!textInput.trim()) {
      return;
    }

    setBusy(true);
    try {
      await getDesktopApi().sendText(textInput);
      setTextInput('');
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
      setSelectedDeviceKey((current) => (current === `saved:${deviceId}` ? '' : current));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero card">
        <div className="hero-top">
          <div>
            <p className="eyebrow">Google TV Remote</p>
            <h1>Desktop remote for Google TV</h1>
            <p className="subtle">
              Choose a TV from the dropdown, then connect or pair depending on whether it is already known.
            </p>
          </div>
          <button className="ghost" disabled={busy || scanning || !bridgeReady} onClick={() => handleScanDevices()}>
            {scanning ? 'Scanning…' : 'Scan Network'}
          </button>
        </div>

        <div className="device-picker-card">
          <label>
            Choose Device
            <select
              value={selectedDeviceKey}
              onChange={(event) => {
                setSelectedDeviceKey(event.target.value);
                setPairingReady(false);
                setPairCode('');
                if (event.target.value.startsWith('saved:')) {
                  setPairingDeviceId(event.target.value.replace('saved:', ''));
                } else {
                  setPairingDeviceId('');
                }
              }}
            >
              <option value="">Choose device</option>
              {pairedNetworkDevices.length > 0 ? (
                <optgroup label="Paired Devices">
                  {pairedNetworkDevices.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.savedDevice.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {unpairedNetworkDevices.length > 0 ? (
                <optgroup label="Available on Network">
                  {unpairedNetworkDevices.map((device) => (
                    <option key={`discovered:${device.id}`} value={`discovered:${device.id}`}>
                      {device.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <div className="device-picker-actions">
            <button className="primary" disabled={busy || !bridgeReady || !selectedDevice} onClick={handleChooseDevice}>
              {primaryActionLabel}
            </button>
            <button
              className="ghost"
              disabled={busy || !bridgeReady || bootstrap.deviceState.status !== 'connected'}
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
            <button
              className="ghost"
              disabled={busy || !bridgeReady || !selectedSavedDevice}
              onClick={() => {
                if (selectedSavedDevice) {
                  void handleRemove(selectedSavedDevice.id);
                }
              }}
            >
              Forget
            </button>
          </div>
          <p className="subtle small">{pickerHelpText}</p>
        </div>

        <div className={`status status-${bootstrap.deviceState.status}`}>
          {bootstrap.deviceState.message}
        </div>
        {!bridgeReady ? <div className="status status-error">Electron bridge not ready yet.</div> : null}
      </section>

      <section className="grid-two">
        <article className="card">
          <div className="section-head">
            <h2>Pair</h2>
            <button className="ghost" disabled={busy || !bridgeReady || !selectedPairedDeviceId} onClick={() => handleStartPairing()}>
              Show TV Code
            </button>
          </div>
          <label>
            Device
            <select
              value={selectedPairedDeviceId}
              onChange={(event) => {
                setPairingDeviceId(event.target.value);
                setSelectedDeviceKey(event.target.value ? `saved:${event.target.value}` : '');
                setPairingReady(false);
                setPairCode('');
              }}
            >
              <option value="">Select a paired device</option>
              {bootstrap.devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Code
            <input
              value={pairCode}
              onChange={(event) => setPairCode(event.target.value)}
              placeholder="6-digit code"
            />
          </label>
          <button className="primary" disabled={busy || !bridgeReady || !selectedPairedDeviceId || !pairingReady || !pairCode.trim()} onClick={handlePair}>
            Confirm Pairing
          </button>
          <p className="subtle small">
            Unpaired TVs start pairing automatically when chosen from the dropdown above. Paired TVs can be re-paired here if needed.
          </p>
        </article>
      </section>

      <section className="card">
        <h2>Remote</h2>
        <p className="subtle small">Keyboard: arrows, enter, escape, H, space, K, plus, minus, P.</p>
        <div className="remote-grid">
          {remoteLayout.map((row, index) => (
            <div className="remote-row" key={index}>
              {row.map((button) => (
                <button
                  key={button.command}
                  className={button.accent ? 'remote-button accent' : 'remote-button'}
                  disabled={busy || !bridgeReady || bootstrap.deviceState.status !== 'connected'}
                  onClick={() => handleCommand(button.command)}
                >
                  {button.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Text Input</h2>
        <div className="row text-row">
          <input
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
            placeholder="Type text to send to the TV"
          />
          <button
            className="primary"
            disabled={busy || !bridgeReady || bootstrap.deviceState.status !== 'connected' || !textInput.trim()}
            onClick={handleSendText}
          >
            Send
          </button>
        </div>
      </section>
    </main>
  );
}

export default App;