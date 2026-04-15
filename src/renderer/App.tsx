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
  const [selectedDiscoveredDeviceId, setSelectedDiscoveredDeviceId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairingDeviceId, setPairingDeviceId] = useState('');
  const [textInput, setTextInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [pairingReady, setPairingReady] = useState(false);
  async function refreshState() {
    const nextBootstrap = await getDesktopApi().bootstrap();
    setBootstrap(nextBootstrap);
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

  async function handleScanDevices(silent = false) {
    setScanning(true);
    try {
      const devices = await getDesktopApi().scanDevices();
      setDiscoveredDevices(devices);
      setSelectedDiscoveredDeviceId((current) => {
        if (devices.some((device: DiscoveredDevice) => device.id === current)) {
          return current;
        }

        return devices[0]?.id ?? '';
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

  async function handleSaveDiscoveredDevice(device: DiscoveredDevice) {
    setBusy(true);
    try {
      const devices = await getDesktopApi().saveDevice({
        name: device.name,
        host: device.host,
        adbPort: device.adbPort || initialDraft.adbPort,
        pairingPort: device.pairingPort
      });
      setBootstrap((current) => ({
        ...current,
        devices,
        deviceState: {
          ...current.deviceState,
          status: 'idle',
          message: `Saved ${device.name}.`
        }
      }));
      setPairingDeviceId((current) => {
        const savedDevice = devices.find((item: SavedDevice) => item.host === device.host);
        return savedDevice?.id ?? current;
      });
      setPairingReady(false);
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

  async function handleSaveSelectedDiscoveredDevice() {
    const device = discoveredDevices.find((item) => item.id === selectedDiscoveredDeviceId);
    if (!device) {
      return;
    }

    await handleSaveDiscoveredDevice(device);
  }

  async function handleStartPairing() {
    if (!pairingDeviceId) {
      return;
    }

    setBusy(true);
    try {
      const deviceState = await getDesktopApi().startPairing(pairingDeviceId);
      setBootstrap((current) => ({ ...current, deviceState }));
      setPairingReady(true);
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

  async function handlePair() {
    if (!pairingDeviceId || !pairCode.trim()) {
      return;
    }

    const device = bootstrap.devices.find((item) => item.id === pairingDeviceId);
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero card">
        <div>
          <p className="eyebrow">Google TV Remote</p>
          <h1>Desktop remote for Google TV</h1>
          <p className="subtle">
            Scan, pair once, connect, and use the remote with either clicks or keyboard keys.
          </p>
        </div>
        <div className={`status status-${bootstrap.deviceState.status}`}>
          {bootstrap.deviceState.message}
        </div>
        {!bridgeReady ? <div className="status status-error">Electron bridge not ready yet.</div> : null}
      </section>

      <section className="grid-two">
        <article className="card">
          <div className="section-head">
            <h2>Devices</h2>
            <button className="primary" disabled={busy || scanning || !bridgeReady} onClick={() => handleScanDevices()}>
              {scanning ? 'Scanning…' : 'Scan'}
            </button>
          </div>
          <div className="device-list">
            {discoveredDevices.length === 0 ? <p className="subtle">No devices found yet.</p> : null}
            {discoveredDevices.map((device) => (
              <button
                type="button"
                className={device.id === selectedDiscoveredDeviceId ? 'device-choice device-choice-selected' : 'device-choice'}
                key={device.id}
                onClick={() => setSelectedDiscoveredDeviceId(device.id)}
              >
                <div>
                  <strong>{device.name}</strong>
                  <p className="subtle small">
                    {device.host}
                    {device.model ? ` · ${device.model}` : ''}
                  </p>
                </div>
                <span className="device-choice-indicator">{device.id === selectedDiscoveredDeviceId ? 'Selected' : 'Select'}</span>
              </button>
            ))}
          </div>
          <button
            className="primary"
            disabled={busy || !bridgeReady || !selectedDiscoveredDeviceId}
            onClick={handleSaveSelectedDiscoveredDevice}
          >
            Save Device
          </button>
          <div className="device-list saved-list">
            {bootstrap.devices.length === 0 ? <p className="subtle">No saved devices yet.</p> : null}
            {bootstrap.devices.map((device: SavedDevice) => {
              const isActive = bootstrap.deviceState.activeDeviceId === device.id;

              return (
                <div className="device-row" key={device.id}>
                  <div>
                    <strong>{device.name}</strong>
                    <p className="subtle small">{device.host}</p>
                  </div>
                  <div className="row actions">
                    <button
                      className="ghost"
                      disabled={busy || !bridgeReady}
                      onClick={() => {
                        setPairingDeviceId(device.id);
                        setPairingReady(false);
                        setPairCode('');
                      }}
                    >
                      Pair
                    </button>
                    <button className="primary" disabled={busy || !bridgeReady} onClick={() => handleConnect(device.id)}>
                      {isActive ? 'Reconnect' : 'Connect'}
                    </button>
                    <button className="ghost" disabled={busy || !bridgeReady} onClick={() => handleRemove(device.id)}>
                      Forget
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="ghost" disabled={busy || !bridgeReady || bootstrap.deviceState.status !== 'connected'} onClick={handleDisconnect}>
            Disconnect
          </button>
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Pair</h2>
            <button className="ghost" disabled={busy || !bridgeReady || !pairingDeviceId} onClick={handleStartPairing}>
              Show TV Code
            </button>
          </div>
          <label>
            Device
            <select
              value={pairingDeviceId}
              onChange={(event) => {
                setPairingDeviceId(event.target.value);
                setPairingReady(false);
                setPairCode('');
              }}
            >
              <option value="">Select a saved device</option>
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
          <button className="primary" disabled={busy || !bridgeReady || !pairingDeviceId || !pairingReady || !pairCode.trim()} onClick={handlePair}>
            Confirm Pairing
          </button>
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