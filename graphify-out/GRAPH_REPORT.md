# Graph Report - gtv-desktop-remote  (2026-05-14)

## Corpus Check
- 38 files · ~47,789 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 295 nodes · 600 edges · 28 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 71 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]

## God Nodes (most connected - your core abstractions)
1. `logInfo()` - 22 edges
2. `CommandMetricsStore` - 22 edges
3. `AndroidTvRemoteBridge` - 21 edges
4. `GoogleTvAdapter` - 20 edges
5. `NoopCommandMetricsStore` - 17 edges
6. `NativeRemoteClient` - 16 edges
7. `getDesktopApi()` - 16 edges
8. `checkForMacUpdate()` - 12 edges
9. `readDevices()` - 12 edges
10. `writeDevices()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Encrypted Pairing Protocol` --semantically_similar_to--> `androidtvremote (pairing certs dir)`  [INFERRED] [semantically similar]
  README.md → scripts/reset-app-state.mjs
- `Favicon SVG - Google TV Remote Outlined Icon` --semantically_similar_to--> `GTV Remote Icon SVG - Google TV Remote Streamline Outlined Material Icon`  [EXTRACTED] [semantically similar]
  public/favicon.svg → assets/icons/gtv-remote-icon.svg
- `setUpdaterStatus()` --calls--> `initialize()`  [INFERRED]
  src/main/updater.ts → src/renderer/App.tsx
- `readUpdateState()` --calls--> `getAppDataPath()`  [INFERRED]
  src/main/updater.ts → src/main/logger.ts
- `writeUpdateState()` --calls--> `getAppDataPath()`  [INFERRED]
  src/main/updater.ts → src/main/logger.ts

## Hyperedges (group relationships)
- **Command Dispatch Pipeline** — app_handlecommand, app_enqueuecommand, app_flushqueuedcommands, app_gtvremote_bridge [INFERRED 0.90]
- **Device Pairing Flow** — app_savedevice, app_startpairingflow, app_handlepair, app_handleconnect [INFERRED 0.85]
- **Device Discovery and Merge (saved + discovered)** — app_finddiscoveredforsaved, app_saveddevice, app_discovereddevice [INFERRED 0.88]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.13
Nodes (14): getLegacyUserDataPaths(), GoogleTvAdapter, clearDeviceStore(), getDeviceStorePath(), getStorePath(), readDevices(), writeDevices(), getAppDataPath() (+6 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (28): clearAssistantLongPressTimer(), convertFloat32ToPcm16(), createCommandRequest(), downsampleTo8kMono(), enqueueCommand(), flushQueuedCommands(), getDesktopApi(), handleCommand() (+20 more)

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (5): AndroidTvRemoteBridge, isCertificateRejectedError(), normalizeRemoteError(), toError(), generateCertificate()

### Community 3 - "Community 3"
Cohesion: 0.17
Nodes (14): NativeRemoteClient, createImeBatchEditMessage(), createRemoteConfigure(), createRemoteKeyInject(), createRemoteKeyInjectRaw(), createRemoteMessage(), createRemotePingResponse(), createRemoteSetActive() (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (4): createCounters(), createEmptySnapshot(), createTransportSnapshot(), NoopCommandMetricsStore

### Community 5 - "Community 5"
Cohesion: 0.21
Nodes (1): CommandMetricsStore

### Community 6 - "Community 6"
Cohesion: 0.26
Nodes (19): applyApplicationIcon(), attachWindowDiagnostics(), bootstrapApp(), buildApplicationMenu(), buildContextMenu(), createTrayImage(), createWindow(), ensureWindow() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.35
Nodes (15): checkForMacUpdate(), checkForUpdatesInBackground(), checkForUpdatesManually(), compareVersions(), downloadFile(), findBestMacAsset(), getBundlePathFromExecPath(), getUpdaterStatus() (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.28
Nodes (11): base64UrlToHex(), createPairingConfiguration(), createPairingOption(), createPairingRequest(), createPairingSecret(), decodeHex(), encodePairingMessage(), getCertificateKeyMaterialFromX509() (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.51
Nodes (9): browseServiceInstances(), buildDeviceFingerprint(), buildDiscoveredId(), decodeDnsSdValue(), discoverGoogleTvDevices(), parseTxtRecord(), resolveHostToIp(), resolveService() (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.5
Nodes (8): connectDevice(), disconnectDevice(), escapeAdbText(), getSerial(), pairDevice(), runAdb(), sendRemoteCommand(), sendRemoteText()

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (8): Favicon 16x16 - GTV Remote, Favicon 32x32 - GTV Remote, Favicon SVG - Google TV Remote Outlined Icon, GTV Remote Icon 512px - Small Remote Control Icon (black outline), GTV Remote Icon SVG - Google TV Remote Streamline Outlined Material Icon, Menubar Icon White - White Remote Control Icon for macOS Menu Bar, Taskbar Icon Black - Monochrome Remote Control Icon, Taskbar Icon - Google TV Remote App Icon (Color, macOS style)

### Community 12 - "Community 12"
Cohesion: 0.8
Nodes (3): hasDebugFlag(), isDebugTelemetryEnabled(), readDebugEnvFlag()

### Community 13 - "Community 13"
Cohesion: 0.5
Nodes (2): releaseAssetUrl(), renderCask()

### Community 14 - "Community 14"
Cohesion: 0.7
Nodes (4): getAppDataRoot(), getResetTargets(), main(), removeTarget()

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (2): Encrypted Pairing Protocol, androidtvremote (pairing certs dir)

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (1): GTV Desktop Remote

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (1): Network Scan

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (1): Keyboard Control

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (1): Global Shortcut CmdOrCtrl+Shift+G

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (1): MAC Address Device Tracking

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (1): Menubar App

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (1): Debug Telemetry

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (1): Bounded Command Queue

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (1): electron-builder Packaging

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (1): Reset App State Script

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (1): devices.json (saved devices file)

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (1): graphify knowledge graph config

## Knowledge Gaps
- **17 isolated node(s):** `GTV Desktop Remote`, `Network Scan`, `Encrypted Pairing Protocol`, `Keyboard Control`, `Global Shortcut CmdOrCtrl+Shift+G` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 5`** (21 nodes): `CommandMetricsStore`, `.detectStalls()`, `.ensureCommand()`, `.getSnapshot()`, `.logMetric()`, `.pushWarning()`, `.recordAdapterDispatchCompleted()`, `.recordAdapterDispatchStart()`, `.recordBridgeSendStart()`, `.recordCommandFailed()`, `.recordCommandSucceeded()`, `.recordConnectCompleted()`, `.recordConnectFailed()`, `.recordConnectStarted()`, `.recordInboundMessage()`, `.recordIpcReceived()`, `.recordRendererDrop()`, `.recordSocketClosed()`, `.recordSocketDrain()`, `.recordSocketWrite()`, `.trimCommands()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (5 nodes): `render-homebrew-cask.mjs`, `parseArgs()`, `releaseAssetUrl()`, `renderCask()`, `requireArg()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (2 nodes): `Encrypted Pairing Protocol`, `androidtvremote (pairing certs dir)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `GTV Desktop Remote`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `Network Scan`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `Keyboard Control`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `Global Shortcut CmdOrCtrl+Shift+G`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `MAC Address Device Tracking`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `Menubar App`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `Debug Telemetry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `Bounded Command Queue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `electron-builder Packaging`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `Reset App State Script`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `devices.json (saved devices file)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `graphify knowledge graph config`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `logInfo()` connect `Community 0` to `Community 2`, `Community 5`, `Community 6`, `Community 7`?**
  _High betweenness centrality (0.412) - this node is a cross-community bridge._
- **Why does `setUpdaterStatus()` connect `Community 7` to `Community 1`?**
  _High betweenness centrality (0.155) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `logInfo()` (e.g. with `bootstrapApp()` and `installMacUpdateFromZip()`) actually correct?**
  _`logInfo()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `GTV Desktop Remote`, `Network Scan`, `Encrypted Pairing Protocol` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._