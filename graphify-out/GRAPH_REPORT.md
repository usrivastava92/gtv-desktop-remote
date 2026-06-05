# Graph Report - gtv-desktop-remote  (2026-06-05)

## Corpus Check
- 116 files · ~85,120 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 481 nodes · 782 edges · 42 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 94 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]

## God Nodes (most connected - your core abstractions)
1. `CommandMetricsStore` - 23 edges
2. `GoogleTvAdapter` - 21 edges
3. `AndroidTvRemoteBridge` - 21 edges
4. `logInfo()` - 19 edges
5. `NoopCommandMetricsStore` - 18 edges
6. `getDesktopApi()` - 15 edges
7. `LibretvGoogleRemoteClient` - 14 edges
8. `rollbackToPreviousVersion()` - 13 edges
9. `createRollbackBackup()` - 12 edges
10. `dispatchUpdaterEvent()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Encrypted Pairing Protocol` --semantically_similar_to--> `androidtvremote (pairing certs dir)`  [INFERRED] [semantically similar]
  README.md → scripts/reset-app-state.mjs
- `Favicon SVG - Google TV Remote Outlined Icon` --semantically_similar_to--> `GTV Remote Icon SVG - Google TV Remote Streamline Outlined Material Icon`  [EXTRACTED] [semantically similar]
  public/favicon.svg → assets/icons/gtv-remote-icon.svg
- `applyUpdaterEvent()` --calls--> `dispatchUpdaterEvent()`  [INFERRED]
  src/backend/updater/updaterStatus.ts → src/main/updater.ts
- `subscribeUpdaterStatus()` --calls--> `createWindow()`  [INFERRED]
  src/main/updater.ts → src/main/main.ts
- `publishUpdaterStatus()` --calls--> `logError()`  [INFERRED]
  src/main/updater.ts → src/main/logger.ts

## Hyperedges (group relationships)
- **Command Dispatch Pipeline** — app_handlecommand, app_enqueuecommand, app_flushqueuedcommands, app_gtvremote_bridge [INFERRED 0.90]
- **Device Pairing Flow** — app_savedevice, app_startpairingflow, app_handlepair, app_handleconnect [INFERRED 0.85]
- **Device Discovery and Merge (saved + discovered)** — app_finddiscoveredforsaved, app_saveddevice, app_discovereddevice [INFERRED 0.88]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (14): AndroidTvRemoteBridge, createAndroidTvRemoteBridge(), LibretvGoogleRemoteClient, loadLibretvGoogle(), isCertificateRejectedError(), normalizeRemoteError(), toError(), captureIpc() (+6 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (12): createFakeClock(), createSystemClock(), hasDebugFlag(), isDebugTelemetryEnabled(), readDebugEnvFlag(), createCommandMetricsStore(), createEmptySnapshot(), createTransportSnapshot() (+4 more)

### Community 2 - "Community 2"
Cohesion: 0.18
Nodes (34): getRuntimeConfig(), getAppDataPath(), checkForMacUpdate(), checkForUpdatesInBackground(), checkForUpdatesManually(), clearRollbackBackup(), createRollbackBackup(), dispatchUpdaterEvent() (+26 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (14): getLegacyUserDataPaths(), GoogleTvAdapter, clearDeviceStore(), getDeviceStorePath(), readDevices(), writeDevices(), createNodeLogger(), getLoggerPath() (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (23): isEditableTarget(), shouldRestartPairingFlow(), appHandleScanDevices(), clearAssistantLongPressTimer(), getDesktopApi(), handleConnect(), handleDisconnect(), handleInstallUpdate() (+15 more)

### Community 5 - "Community 5"
Cohesion: 0.21
Nodes (1): CommandMetricsStore

### Community 6 - "Community 6"
Cohesion: 0.27
Nodes (19): applyApplicationIcon(), attachWindowDiagnostics(), bootstrapApp(), buildApplicationMenu(), buildContextMenu(), createTrayImage(), createWindow(), ensureWindow() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.22
Nodes (10): base64UrlToHex(), createPairingConfiguration(), createPairingOption(), createPairingRequest(), createPairingSecret(), decodeHex(), encodePairingMessage(), getCertificateKeyMaterialFromX509() (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.25
Nodes (12): createRemoteConfigure(), createRemoteKeyInject(), createRemoteKeyInjectRaw(), createRemoteMessage(), createRemotePingResponse(), createRemoteSetActive(), createRemoteVoiceBegin(), createRemoteVoiceEnd() (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.51
Nodes (9): browseServiceInstances(), buildDeviceFingerprint(), buildDiscoveredId(), decodeDnsSdValue(), discoverGoogleTvDevices(), parseTxtRecord(), resolveHostToIp(), resolveService() (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (1): VoiceSessionService

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (2): AppFacade, InMemoryPathProvider

### Community 12 - "Community 12"
Cohesion: 0.36
Nodes (1): DeviceRepository

### Community 13 - "Community 13"
Cohesion: 0.36
Nodes (1): AndroidTvCertStore

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (8): Favicon 16x16 - GTV Remote, Favicon 32x32 - GTV Remote, Favicon SVG - Google TV Remote Outlined Icon, GTV Remote Icon 512px - Small Remote Control Icon (black outline), GTV Remote Icon SVG - Google TV Remote Streamline Outlined Material Icon, Menubar Icon White - White Remote Control Icon for macOS Menu Bar, Taskbar Icon Black - Monochrome Remote Control Icon, Taskbar Icon - Google TV Remote App Icon (Color, macOS style)

### Community 15 - "Community 15"
Cohesion: 0.48
Nodes (5): findExistingForDraft(), identityChanged(), matchSavedToDiscovered(), mergeIdentity(), normalizeDraft()

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (1): createInMemoryLogger()

### Community 18 - "Community 18"
Cohesion: 0.53
Nodes (4): createNodeRuntimeConfig(), createRuntimeConfig(), resetRuntimeConfig(), setRuntimeConfig()

### Community 19 - "Community 19"
Cohesion: 0.7
Nodes (3): applyUpdaterEvent(), createInitialUpdaterStatus(), mergeUpdaterStatus()

### Community 20 - "Community 20"
Cohesion: 0.7
Nodes (3): convertFloat32ToPcm16(), downsampleTo8kMono(), toBase64()

### Community 21 - "Community 21"
Cohesion: 0.5
Nodes (2): releaseAssetUrl(), renderCask()

### Community 22 - "Community 22"
Cohesion: 0.7
Nodes (4): getAppDataRoot(), getResetTargets(), main(), removeTarget()

### Community 23 - "Community 23"
Cohesion: 0.6
Nodes (3): ensureDir(), writeBin(), writeJson()

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (2): createFakeFramedTlsTransport(), createFramedTlsTransportOverSocket()

### Community 26 - "Community 26"
Cohesion: 0.83
Nodes (2): decodeVarintHeader(), parseFramedBuffer()

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (2): encodeVarint(), frame()

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (1): createNodeTlsConnector()

### Community 31 - "Community 31"
Cohesion: 0.67
Nodes (1): createNodeFileSystem()

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (1): generateCertificate()

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (2): Encrypted Pairing Protocol, androidtvremote (pairing certs dir)

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (1): GTV Desktop Remote

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (1): Network Scan

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (1): Keyboard Control

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (1): Global Shortcut CmdOrCtrl+Shift+G

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (1): MAC Address Device Tracking

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (1): Menubar App

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (1): Debug Telemetry

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (1): Bounded Command Queue

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (1): electron-builder Packaging

### Community 92 - "Community 92"
Cohesion: 1.0
Nodes (1): Reset App State Script

### Community 93 - "Community 93"
Cohesion: 1.0
Nodes (1): devices.json (saved devices file)

### Community 94 - "Community 94"
Cohesion: 1.0
Nodes (1): graphify knowledge graph config

## Knowledge Gaps
- **17 isolated node(s):** `GTV Desktop Remote`, `Network Scan`, `Encrypted Pairing Protocol`, `Keyboard Control`, `Global Shortcut CmdOrCtrl+Shift+G` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 5`** (21 nodes): `CommandMetricsStore`, `.detectStalls()`, `.ensureCommand()`, `.getSnapshot()`, `.logMetric()`, `.pushWarning()`, `.recordAdapterDispatchCompleted()`, `.recordAdapterDispatchStart()`, `.recordBridgeSendStart()`, `.recordCommandFailed()`, `.recordCommandSucceeded()`, `.recordConnectCompleted()`, `.recordConnectFailed()`, `.recordConnectStarted()`, `.recordInboundMessage()`, `.recordIpcReceived()`, `.recordRendererDrop()`, `.recordSocketClosed()`, `.recordSocketDrain()`, `.recordSocketWrite()`, `.trimCommands()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 10`** (9 nodes): `VoiceSessionService.js`, `VoiceSessionService.ts`, `VoiceSessionService`, `.constructor()`, `.hasPending()`, `.sendChunk()`, `.start()`, `.stop()`, `._trackedSessions()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 11`** (9 nodes): `AppFacade`, `.constructor()`, `.getVoiceSessionService()`, `.listDevices()`, `.writeDevices()`, `InMemoryPathProvider`, `.constructor()`, `.getAppDataPath()`, `AppFacade.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (8 nodes): `DeviceRepository`, `.clear()`, `.constructor()`, `.read()`, `.storePath()`, `.write()`, `deviceRepository.js`, `deviceRepository.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (8 nodes): `AndroidTvCertStore`, `.clear()`, `.constructor()`, `.getFilesForCertKey()`, `.loadOrCreate()`, `.migrate()`, `androidTvCertStore.js`, `androidTvCertStore.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (6 nodes): `createInMemoryLogger()`, `error()`, `info()`, `warn()`, `logger.js`, `logger.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (5 nodes): `render-homebrew-cask.mjs`, `parseArgs()`, `releaseAssetUrl()`, `renderCask()`, `requireArg()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (4 nodes): `framedTlsTransport.js`, `framedTlsTransport.ts`, `createFakeFramedTlsTransport()`, `createFramedTlsTransportOverSocket()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (4 nodes): `frameParser.js`, `decodeVarintHeader()`, `parseFramedBuffer()`, `frameParser.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (4 nodes): `frameParser.test.ts`, `encodeVarint()`, `expectBuffer()`, `frame()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (3 nodes): `tlsConnector.js`, `tlsConnector.ts`, `createNodeTlsConnector()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (3 nodes): `createNodeFileSystem()`, `fileSystem.js`, `fileSystem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (3 nodes): `generateCertificate()`, `certificate.js`, `certificate.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `Encrypted Pairing Protocol`, `androidtvremote (pairing certs dir)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `GTV Desktop Remote`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `Network Scan`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `Keyboard Control`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (1 nodes): `Global Shortcut CmdOrCtrl+Shift+G`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (1 nodes): `MAC Address Device Tracking`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (1 nodes): `Menubar App`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (1 nodes): `Debug Telemetry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (1 nodes): `Bounded Command Queue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (1 nodes): `electron-builder Packaging`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (1 nodes): `Reset App State Script`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (1 nodes): `devices.json (saved devices file)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (1 nodes): `graphify knowledge graph config`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `logInfo()` connect `Community 3` to `Community 2`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.117) - this node is a cross-community bridge._
- **Why does `CommandMetricsStore` connect `Community 5` to `Community 1`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `discoverGoogleTvDevices()` connect `Community 9` to `Community 0`, `Community 3`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Are the 16 inferred relationships involving `logInfo()` (e.g. with `bootstrapApp()` and `recoverOrphanedRollbackState()`) actually correct?**
  _`logInfo()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **What connects `GTV Desktop Remote`, `Network Scan`, `Encrypted Pairing Protocol` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._