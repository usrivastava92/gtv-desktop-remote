# Graph Report - . (2026-04-30)

## Corpus Check

- Corpus is ~30,285 words - fits in a single context window. You may not need a graph.

## Summary

- 287 nodes · 524 edges · 23 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.82)
- Token cost: 1,200 input · 600 output

## Community Hubs (Navigation)

- [[_COMMUNITY_App State & Command Dispatch|App State & Command Dispatch]]
- [[_COMMUNITY_Google TV Adapter|Google TV Adapter]]
- [[_COMMUNITY_Command Queue|Command Queue]]
- [[_COMMUNITY_Android TV Remote Bridge|Android TV Remote Bridge]]
- [[_COMMUNITY_Native Remote Client|Native Remote Client]]
- [[_COMMUNITY_Command Metrics Store|Command Metrics Store]]
- [[_COMMUNITY_Metrics Reporting|Metrics Reporting]]
- [[_COMMUNITY_Electron Main Process|Electron Main Process]]
- [[_COMMUNITY_Pairing Protocol|Pairing Protocol]]
- [[_COMMUNITY_Device Discovery|Device Discovery]]
- [[_COMMUNITY_ADB Device Management|ADB Device Management]]
- [[_COMMUNITY_Brand Assets & Icons|Brand Assets & Icons]]
- [[_COMMUNITY_Debug Utilities|Debug Utilities]]
- [[_COMMUNITY_App State Reset|App State Reset]]
- [[_COMMUNITY_App Overview|App Overview]]
- [[_COMMUNITY_Network Scan|Network Scan]]
- [[_COMMUNITY_Global Shortcut|Global Shortcut]]
- [[_COMMUNITY_Menubar App|Menubar App]]
- [[_COMMUNITY_Electron Builder Config|Electron Builder Config]]
- [[_COMMUNITY_RemoteCommand Type|RemoteCommand Type]]
- [[_COMMUNITY_RemoteCommandSource Type|RemoteCommandSource Type]]
- [[_COMMUNITY_DeviceDraft Type|DeviceDraft Type]]
- [[_COMMUNITY_Graphify Config|Graphify Config]]

## God Nodes (most connected - your core abstractions)

1. `CommandMetricsStore` - 22 edges
2. `NoopCommandMetricsStore` - 17 edges
3. `AndroidTvRemoteBridge` - 17 edges
4. `logInfo()` - 15 edges
5. `GoogleTvAdapter` - 15 edges
6. `getDesktopApi()` - 14 edges
7. `App React Component` - 14 edges
8. `getDesktopApi` - 13 edges
9. `NativeRemoteClient` - 12 edges
10. `readDevices()` - 11 edges

## Surprising Connections (you probably didn't know these)

- `androidtvremote (pairing certs dir)` --semantically_similar_to--> `Encrypted Pairing Protocol` [INFERRED] [semantically similar]
  scripts/reset-app-state.mjs → README.md
- `Encrypted Pairing Protocol` --conceptually_related_to--> `handlePair` [INFERRED]
  README.md → src/renderer/App.tsx
- `Encrypted Pairing Protocol` --conceptually_related_to--> `startPairingFlow` [INFERRED]
  README.md → src/renderer/App.tsx
- `Keyboard Control` --conceptually_related_to--> `keyboardCommandMap` [INFERRED]
  README.md → src/renderer/App.tsx
- `Keyboard Control` --conceptually_related_to--> `handleCommand` [INFERRED]
  README.md → src/renderer/App.tsx

## Hyperedges (group relationships)

- **Command Dispatch Pipeline** — app_handlecommand, app_enqueuecommand, app_flushqueuedcommands, app_gtvremote_bridge [INFERRED 0.90]
- **Device Pairing Flow** — app_savedevice, app_startpairingflow, app_handlepair, app_handleconnect [INFERRED 0.85]
- **Device Discovery and Merge (saved + discovered)** — app_finddiscoveredforsaved, app_saveddevice, app_discovereddevice [INFERRED 0.88]

## Communities

### Community 0 - "App State & Command Dispatch"

Cohesion: 0.06
Nodes (46): BootstrapState, burstSensitiveCommands, CommandDispatchRequest, App React Component, createCommandRequest, DeviceCapabilities, DiscoveredDevice, enqueueCommand (+38 more)

### Community 1 - "Google TV Adapter"

Cohesion: 0.15
Nodes (14): getLegacyUserDataPaths(), GoogleTvAdapter, clearDeviceStore(), getDeviceStorePath(), getStorePath(), readDevices(), writeDevices(), getAppDataPath() (+6 more)

### Community 2 - "Command Queue"

Cohesion: 0.14
Nodes (23): createCommandRequest(), enqueueCommand(), flushQueuedCommands(), getDesktopApi(), handleCommand(), handleConnect(), handleDisconnect(), handlePair() (+15 more)

### Community 3 - "Android TV Remote Bridge"

Cohesion: 0.2
Nodes (5): AndroidTvRemoteBridge, isCertificateRejectedError(), normalizeRemoteError(), toError(), generateCertificate()

### Community 4 - "Native Remote Client"

Cohesion: 0.19
Nodes (10): NativeRemoteClient, createImeBatchEditMessage(), createRemoteConfigure(), createRemoteKeyInject(), createRemoteMessage(), createRemotePingResponse(), createRemoteSetActive(), decodeRemoteMessage() (+2 more)

### Community 5 - "Command Metrics Store"

Cohesion: 0.21
Nodes (1): CommandMetricsStore

### Community 6 - "Metrics Reporting"

Cohesion: 0.12
Nodes (4): createCounters(), createEmptySnapshot(), createTransportSnapshot(), NoopCommandMetricsStore

### Community 7 - "Electron Main Process"

Cohesion: 0.31
Nodes (16): applyApplicationIcon(), attachWindowDiagnostics(), bootstrapApp(), buildContextMenu(), createTrayImage(), createWindow(), ensureWindow(), getAssetPath() (+8 more)

### Community 8 - "Pairing Protocol"

Cohesion: 0.28
Nodes (11): base64UrlToHex(), createPairingConfiguration(), createPairingOption(), createPairingRequest(), createPairingSecret(), decodeHex(), encodePairingMessage(), getCertificateKeyMaterialFromX509() (+3 more)

### Community 9 - "Device Discovery"

Cohesion: 0.56
Nodes (8): browseServiceInstances(), buildDiscoveredId(), decodeDnsSdValue(), discoverGoogleTvDevices(), parseTxtRecord(), resolveHostToIp(), resolveService(), runDnsSd()

### Community 10 - "ADB Device Management"

Cohesion: 0.5
Nodes (8): connectDevice(), disconnectDevice(), escapeAdbText(), getSerial(), pairDevice(), runAdb(), sendRemoteCommand(), sendRemoteText()

### Community 11 - "Brand Assets & Icons"

Cohesion: 0.29
Nodes (8): Favicon 16x16 - GTV Remote, Favicon 32x32 - GTV Remote, Favicon SVG - Google TV Remote Outlined Icon, GTV Remote Icon 512px - Small Remote Control Icon (black outline), GTV Remote Icon SVG - Google TV Remote Streamline Outlined Material Icon, Menubar Icon White - White Remote Control Icon for macOS Menu Bar, Taskbar Icon Black - Monochrome Remote Control Icon, Taskbar Icon - Google TV Remote App Icon (Color, macOS style)

### Community 12 - "Debug Utilities"

Cohesion: 0.8
Nodes (3): hasDebugFlag(), isDebugTelemetryEnabled(), readDebugEnvFlag()

### Community 13 - "App State Reset"

Cohesion: 0.7
Nodes (4): getAppDataRoot(), getResetTargets(), main(), removeTarget()

### Community 24 - "App Overview"

Cohesion: 1.0
Nodes (1): GTV Desktop Remote

### Community 25 - "Network Scan"

Cohesion: 1.0
Nodes (1): Network Scan

### Community 26 - "Global Shortcut"

Cohesion: 1.0
Nodes (1): Global Shortcut CmdOrCtrl+Shift+G

### Community 27 - "Menubar App"

Cohesion: 1.0
Nodes (1): Menubar App

### Community 28 - "Electron Builder Config"

Cohesion: 1.0
Nodes (1): electron-builder Packaging

### Community 29 - "RemoteCommand Type"

Cohesion: 1.0
Nodes (1): RemoteCommand

### Community 30 - "RemoteCommandSource Type"

Cohesion: 1.0
Nodes (1): RemoteCommandSource

### Community 31 - "DeviceDraft Type"

Cohesion: 1.0
Nodes (1): DeviceDraft

### Community 32 - "Graphify Config"

Cohesion: 1.0
Nodes (1): graphify knowledge graph config

## Knowledge Gaps

- **34 isolated node(s):** `GTV Desktop Remote`, `Network Scan`, `Global Shortcut CmdOrCtrl+Shift+G`, `MAC Address Device Tracking`, `Menubar App` (+29 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Command Metrics Store`** (21 nodes): `CommandMetricsStore`, `.detectStalls()`, `.ensureCommand()`, `.getSnapshot()`, `.logMetric()`, `.pushWarning()`, `.recordAdapterDispatchCompleted()`, `.recordAdapterDispatchStart()`, `.recordBridgeSendStart()`, `.recordCommandFailed()`, `.recordCommandSucceeded()`, `.recordConnectCompleted()`, `.recordConnectFailed()`, `.recordConnectStarted()`, `.recordInboundMessage()`, `.recordIpcReceived()`, `.recordRendererDrop()`, `.recordSocketClosed()`, `.recordSocketDrain()`, `.recordSocketWrite()`, `.trimCommands()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `App Overview`** (1 nodes): `GTV Desktop Remote`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Network Scan`** (1 nodes): `Network Scan`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Global Shortcut`** (1 nodes): `Global Shortcut CmdOrCtrl+Shift+G`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Menubar App`** (1 nodes): `Menubar App`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Electron Builder Config`** (1 nodes): `electron-builder Packaging`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `RemoteCommand Type`** (1 nodes): `RemoteCommand`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `RemoteCommandSource Type`** (1 nodes): `RemoteCommandSource`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `DeviceDraft Type`** (1 nodes): `DeviceDraft`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Graphify Config`** (1 nodes): `graphify knowledge graph config`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `logInfo()` connect `Google TV Adapter` to `Android TV Remote Bridge`, `Command Metrics Store`, `Electron Main Process`?**
  _High betweenness centrality (0.193) - this node is a cross-community bridge._
- **Why does `CommandMetricsStore` connect `Command Metrics Store` to `Metrics Reporting`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `logInfo()` (e.g. with `bootstrapApp()` and `.logMetric()`) actually correct?**
  _`logInfo()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `GTV Desktop Remote`, `Network Scan`, `Global Shortcut CmdOrCtrl+Shift+G` to the rest of the system?**
  _34 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App State & Command Dispatch` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Command Queue` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._
- **Should `Metrics Reporting` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
