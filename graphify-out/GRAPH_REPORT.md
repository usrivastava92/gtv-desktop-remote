# Graph Report - /Users/usrivastava/workspace/github/gtv-desktop-remote  (2026-05-31)

## Corpus Check
- 119 files · ~88,069 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 472 nodes · 850 edges · 94 communities detected
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 154 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
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
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
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

## God Nodes (most connected - your core abstractions)
1. `logInfo()` - 24 edges
2. `CommandMetricsStore` - 23 edges
3. `GoogleTvAdapter` - 21 edges
4. `AndroidTvRemoteBridge` - 21 edges
5. `NoopCommandMetricsStore` - 18 edges
6. `getDesktopApi()` - 15 edges
7. `rollbackToPreviousVersion()` - 14 edges
8. `LibretvGoogleRemoteClient` - 14 edges
9. `createRollbackBackup()` - 12 edges
10. `installAvailableUpdate()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Encrypted Pairing Protocol` --semantically_similar_to--> `androidtvremote (pairing certs dir)`  [INFERRED] [semantically similar]
  README.md → scripts/reset-app-state.mjs
- `Favicon SVG - Google TV Remote Outlined Icon` --semantically_similar_to--> `GTV Remote Icon SVG - Google TV Remote Streamline Outlined Material Icon`  [EXTRACTED] [semantically similar]
  public/favicon.svg → assets/icons/gtv-remote-icon.svg
- `installMacUpdateFromZip()` --calls--> `getRuntimeConfig()`  [INFERRED]
  /Users/usrivastava/workspace/github/gtv-desktop-remote/src/main/updater.ts → /Users/usrivastava/workspace/github/gtv-desktop-remote/src/backend/core/runtimeConfig.ts
- `checkForMacUpdate()` --calls--> `getRuntimeConfig()`  [INFERRED]
  /Users/usrivastava/workspace/github/gtv-desktop-remote/src/main/updater.ts → /Users/usrivastava/workspace/github/gtv-desktop-remote/src/backend/core/runtimeConfig.ts
- `installAvailableUpdate()` --calls--> `getRuntimeConfig()`  [INFERRED]
  /Users/usrivastava/workspace/github/gtv-desktop-remote/src/main/updater.ts → /Users/usrivastava/workspace/github/gtv-desktop-remote/src/backend/core/runtimeConfig.ts

## Hyperedges (group relationships)
- **Command Dispatch Pipeline** — app_handlecommand, app_enqueuecommand, app_flushqueuedcommands, app_gtvremote_bridge [INFERRED 0.90]
- **Device Pairing Flow** — app_savedevice, app_startpairingflow, app_handlepair, app_handleconnect [INFERRED 0.85]
- **Device Discovery and Merge (saved + discovered)** — app_finddiscoveredforsaved, app_saveddevice, app_discovereddevice [INFERRED 0.88]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (10): DeviceRepository, getLegacyUserDataPaths(), GoogleTvAdapter, info(), logInfo(), clearDeviceStore(), getDeviceStorePath(), readDevices() (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.18
Nodes (33): logError(), checkForMacUpdate(), checkForUpdatesInBackground(), checkForUpdatesManually(), clearRollbackBackup(), createRollbackBackup(), dispatchUpdaterEvent(), downloadFile() (+25 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (12): AndroidTvRemoteBridge, isCertificateRejectedError(), normalizeRemoteError(), toError(), captureIpc(), closeCapture(), getCaptureFilePath(), initCapture() (+4 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (23): appHandleScanDevices(), clearAssistantLongPressTimer(), getDesktopApi(), handleConnect(), handleDisconnect(), handleInstallUpdate(), handlePair(), handleRemove() (+15 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (4): createAndroidTvRemoteBridge(), LibretvGoogleRemoteClient, loadLibretvGoogle(), NoopCommandMetricsStore

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (3): createFakeClock(), createSystemClock(), CommandMetricsStore

### Community 6 - "Community 6"
Cohesion: 0.27
Nodes (19): applyApplicationIcon(), attachWindowDiagnostics(), bootstrapApp(), buildApplicationMenu(), buildContextMenu(), createTrayImage(), createWindow(), ensureWindow() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.18
Nodes (13): ensureDir(), findLatestCapture(), writeBin(), writeJson(), createInMemoryLogger(), createNodeLogger(), error(), getAppDataPath() (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.28
Nodes (11): base64UrlToHex(), createPairingConfiguration(), createPairingOption(), createPairingRequest(), createPairingSecret(), decodeHex(), encodePairingMessage(), getCertificateKeyMaterialFromX509() (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (9): hasDebugFlag(), isDebugTelemetryEnabled(), readDebugEnvFlag(), createEmptyMetricsCounters(), createEmptyMetricsSnapshot(), createSilentMetricsRecorder(), createCommandMetricsStore(), createEmptySnapshot() (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.34
Nodes (13): createImeBatchEditMessage(), createRemoteConfigure(), createRemoteKeyInject(), createRemoteKeyInjectRaw(), createRemoteMessage(), createRemotePingResponse(), createRemoteSetActive(), createRemoteVoiceBegin() (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.51
Nodes (9): browseServiceInstances(), buildDeviceFingerprint(), buildDiscoveredId(), decodeDnsSdValue(), discoverGoogleTvDevices(), parseTxtRecord(), resolveHostToIp(), resolveService() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.22
Nodes (2): AppFacade, InMemoryPathProvider

### Community 13 - "Community 13"
Cohesion: 0.29
Nodes (8): Favicon 16x16 - GTV Remote, Favicon 32x32 - GTV Remote, Favicon SVG - Google TV Remote Outlined Icon, GTV Remote Icon 512px - Small Remote Control Icon (black outline), GTV Remote Icon SVG - Google TV Remote Streamline Outlined Material Icon, Menubar Icon White - White Remote Control Icon for macOS Menu Bar, Taskbar Icon Black - Monochrome Remote Control Icon, Taskbar Icon - Google TV Remote App Icon (Color, macOS style)

### Community 14 - "Community 14"
Cohesion: 0.52
Nodes (5): createNodeRuntimeConfig(), createRuntimeConfig(), getRuntimeConfig(), resetRuntimeConfig(), setRuntimeConfig()

### Community 15 - "Community 15"
Cohesion: 0.48
Nodes (5): findExistingForDraft(), identityChanged(), matchSavedToDiscovered(), mergeIdentity(), normalizeDraft()

### Community 16 - "Community 16"
Cohesion: 0.7
Nodes (3): convertFloat32ToPcm16(), downsampleTo8kMono(), toBase64()

### Community 17 - "Community 17"
Cohesion: 0.5
Nodes (2): releaseAssetUrl(), renderCask()

### Community 18 - "Community 18"
Cohesion: 0.7
Nodes (4): getAppDataRoot(), getResetTargets(), main(), removeTarget()

### Community 19 - "Community 19"
Cohesion: 0.4
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 0.7
Nodes (3): applyUpdaterEvent(), createInitialUpdaterStatus(), mergeUpdaterStatus()

### Community 21 - "Community 21"
Cohesion: 0.67
Nodes (2): createFakeFramedTlsTransport(), createFramedTlsTransportOverSocket()

### Community 22 - "Community 22"
Cohesion: 0.83
Nodes (2): decodeVarintHeader(), parseFramedBuffer()

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (2): encodeVarint(), frame()

### Community 24 - "Community 24"
Cohesion: 0.5
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 0.5
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (1): createNodeTlsConnector()

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (1): createNodeFileSystem()

### Community 28 - "Community 28"
Cohesion: 0.67
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (2): Encrypted Pairing Protocol, androidtvremote (pairing certs dir)

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (0): 

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (0): 

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (0): 

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (0): 

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (0): 

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (0): 

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (0): 

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (0): 

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (1): GTV Desktop Remote

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (1): Network Scan

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (1): Keyboard Control

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (1): Global Shortcut CmdOrCtrl+Shift+G

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (1): MAC Address Device Tracking

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (1): Menubar App

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (1): Debug Telemetry

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (1): Bounded Command Queue

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (1): electron-builder Packaging

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (1): Reset App State Script

### Community 92 - "Community 92"
Cohesion: 1.0
Nodes (1): devices.json (saved devices file)

### Community 93 - "Community 93"
Cohesion: 1.0
Nodes (1): graphify knowledge graph config

## Knowledge Gaps
- **17 isolated node(s):** `GTV Desktop Remote`, `Network Scan`, `Encrypted Pairing Protocol`, `Keyboard Control`, `Global Shortcut CmdOrCtrl+Shift+G` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 29`** (2 nodes): `sleep()`, `tv-test.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `getDesktopApi()`, `api.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `useCounter()`, `harness.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `usePairingFlow()`, `usePairingFlow.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `useUpdaterStatus.ts`, `useUpdaterStatus()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `useRemoteSession()`, `useRemoteSession.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `useDeviceScanner()`, `useDeviceScanner.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `makeFakeSocket()`, `framedTlsTransport.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `VoiceSessionService.test.ts`, `makeFakes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `makeFakeFs()`, `deviceRepository.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `Encrypted Pairing Protocol`, `androidtvremote (pairing certs dir)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `commitlint.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `eslint.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `tailwind.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `vite.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `pathProvider.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `desktopApi.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `types.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `ipcContract.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `audio.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `ipcContract.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `preload.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `remoteProtocol.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `certificate.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `pairingProtocol.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `vite-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `remoteCommands.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `pure.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `IMetricsRecorder.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `tlsConnector.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `pathProvider.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `runtimeConfig.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `clock.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `logger.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `updaterStatus.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `version.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `checkStartedMessage.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `remote.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `pairing.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `certificate.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `harness.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `desktopApi.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `ipcContract.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `ipcContract.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `audio.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `preload.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `pairingProtocol.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `remoteProtocol.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `certificate.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `GTV Desktop Remote`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `Network Scan`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `Keyboard Control`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `Global Shortcut CmdOrCtrl+Shift+G`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (1 nodes): `MAC Address Device Tracking`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (1 nodes): `Menubar App`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (1 nodes): `Debug Telemetry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (1 nodes): `Bounded Command Queue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (1 nodes): `electron-builder Packaging`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (1 nodes): `Reset App State Script`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (1 nodes): `devices.json (saved devices file)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (1 nodes): `graphify knowledge graph config`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `logInfo()` connect `Community 0` to `Community 1`, `Community 2`, `Community 5`, `Community 6`, `Community 7`?**
  _High betweenness centrality (0.180) - this node is a cross-community bridge._
- **Why does `write()` connect `Community 7` to `Community 0`, `Community 1`, `Community 2`, `Community 8`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `CommandMetricsStore` connect `Community 5` to `Community 9`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `logInfo()` (e.g. with `bootstrapApp()` and `recoverOrphanedRollbackState()`) actually correct?**
  _`logInfo()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **What connects `GTV Desktop Remote`, `Network Scan`, `Encrypted Pairing Protocol` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._