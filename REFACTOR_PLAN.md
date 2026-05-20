# GTV Desktop Remote — Refactor & Universal-Remote Plan

> Single source of truth for the de-factoring work. Replaces / supersedes any other
> design notes until merged. **No Jira/GitHub tickets** — work is tracked as a
> chain of small PRs against `main` (each one independently mergeable, semantic-
> release friendly, conventional-commit titled per the repo's `[risk] [TICKET]`
> convention, with `NO-JIRA` as the ticket tag for refactor-only PRs).

---

## 0. Why we're doing this

The repo started as a Google TV / Android TV remote and has grown features
(updater, rollback, voice/Assistant, IP-change resilience, metrics) bolted on
to the same modules. Symptoms today:

- **2,121-line `src/renderer/App.tsx`** holds UI + keyboard handling + queue +
  PCM audio DSP + updater UX + device picker.
- **771-line `src/main/device/androidTvRemote.ts`** holds TLS socket lifecycle,
  framing, cert disk I/O, voice sessions, retry, cert migration.
- **523-line `src/main/device/googleTvAdapter.ts`** holds scan, persist,
  pair, connect, command, voice, capabilities — and reaches directly into
  Electron's `app.getPath`, the logger, the metrics singleton, and the bridge
  singleton.
- **984-line `src/main/updater.ts`** mixes GitHub fetching, file I/O, dialog
  presentation, and `app.relaunch`.
- **Zero tests anywhere.** No `npm test`, no Vitest/Jest, no fixtures.
- **IPC channel names duplicated** in `preload.ts` and `main.ts`.
- **Renderer polls** `getUpdaterStatus` every 1.5s because there's no event
  channel.

Two goals:

1. **De-factor** into well-bounded backend services with a thin, pluggable
   renderer. Backend code = pure Node, no Electron, no React — and **≥95%
   line coverage** on protocol / transport / pairing / remote / updater.
2. **Open the door to Apple TV** (and later Roku / webOS / Tizen / Fire TV)
   as additive driver implementations, not as a rewrite. "Universal remote"
   becomes a natural consequence of the refactor, not a parallel effort.

---

## 1. Target architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  src/renderer  (React, thin)                                         │
│   - presentational components + small hooks                          │
│   - talks ONLY to window.gtvRemote (typed RPC client)                │
│   - zero protocol code, zero audio DSP, zero persistence             │
└──────────────────────────────────────────────────────────────────────┘
              ▲                                          │
              │ events (push)               commands (RPC)
              │                                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│  src/main  (Electron shell — VERY THIN, no business logic)           │
│   - app lifecycle, tray, menu, window, global shortcut               │
│   - IPC bridge: ipcMain.handle → backend service calls               │
│   - subscribes to backend events → ipc.send                          │
│   - depends on services via interfaces; wires concrete impls         │
└──────────────────────────────────────────────────────────────────────┘
                                ▲
                                │  pure TS interfaces
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  src/backend  (pure-Node services — NO electron, NO React)           │
│   core/         logging, clock, fs, paths, eventbus, ids (ports)    │
│   protocol/                                                          │
│     androidtv/  pairing, remote, cert (existing)                    │
│     appletv/    mrp, hap, companion        (NEW — future)            │
│   transport/    framed-tls + framed-chacha (NEW)                     │
│   discovery/    DiscoveryService + per-kind providers                │
│   devices/      DeviceRepository, DeviceRegistry, credential stores  │
│   pairing/      PairingService + IPairingDriver per kind             │
│   remote/       RemoteCommandRouter + IRemoteSessionDriver per kind  │
│   voice/        VoiceSessionService (+ PCM encoder moved out of UI)  │
│   metrics/      CommandMetricsService                                │
│   updater/      ReleaseSource + UpdateInstaller + UpdateStateMachine │
│   app/          AppFacade — the only thing main.ts touches           │
└──────────────────────────────────────────────────────────────────────┘
```

**Hard layering rules** (enforced by ESLint + `tsconfig.backend.json`):

- `src/backend/**` MAY NOT import `electron`, `react`, `react-dom`, anything
  from `src/renderer/**`, or anything from `src/main/**`.
- `src/renderer/**` MAY NOT import `electron`, anything from `src/main/**`, or
  anything from `src/backend/**`. Only `src/shared/**` and the typed RPC
  client.
- `src/main/**` is allowed to import from `src/backend/**` and `src/shared/**`
  (it's the composition root).
- `src/shared/**` is types-only (no runtime side effects, no imports of
  electron/react/node-only APIs).

---

## 2. Module responsibility table

### Backend services (`src/backend/**`) — high-coverage targets

| Module                                                    | Replaces                                                                | Public surface                                      | Test priority | Target coverage |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- | ------------- | --------------- |
| `core/Logger` (`ILogger`)                                 | `src/main/logger.ts`                                                    | `info/warn/error(scope,msg,details)`                | low           | 80%             |
| `core/Clock`, `IdGenerator`, `FileSystem`, `PathProvider` | inline `Date.now()`, `randomUUID()`, `fs.*`, `app.getPath`              | tiny ports                                          | low           | 80%             |
| `protocol/androidtv/certificate`                          | `protocol/certificate.ts`                                               | `generate(commonName): PemPair`                     | HIGH          | 95%             |
| `protocol/androidtv/pairing` (codec)                      | `protocol/pairingProtocol.ts`                                           | pure encode/decode                                  | CRITICAL      | **98%**         |
| `pairing/androidTvPairingDriver`                          | FSM half of `PairingManager`                                            | `start/onMessage/sendCode`                          | CRITICAL      | 95%             |
| `protocol/androidtv/remote` (codec)                       | `protocol/remoteProtocol.ts`                                            | pure encode/decode                                  | CRITICAL      | **98%**         |
| `transport/framed-tls/FramedTlsTransport`                 | low half of `NativeRemoteClient`                                        | `connect/send/onFrame/close`                        | HIGH          | 95%             |
| `remote/androidTvRemoteDriver`                            | upper half of `NativeRemoteClient`                                      | high-level commands, keepalive, retry               | HIGH          | 95%             |
| `devices/credentials/androidTvCertStore`                  | cert-on-disk methods of `AndroidTvRemoteBridge`                         | `load/save/migrate(host↔mac)`                       | HIGH          | 95%             |
| `discovery/androidTvDiscovery`                            | `device/discovery.ts`                                                   | `discover(): DiscoveredDevice[]`                    | MEDIUM        | 90%             |
| `discovery/DiscoveryService`                              | NEW aggregator                                                          | merges multiple providers                           | MEDIUM        | 90%             |
| `devices/DeviceRepository`                                | `device/store.ts`                                                       | CRUD over `SavedDevice[]`                           | HIGH          | 95%             |
| `devices/DeviceRegistry`                                  | identity-matching from `googleTvAdapter.runDeviceScan/saveDevice`       | `reconcile(scan)`, `match(draft)`                   | CRITICAL      | 95%             |
| `pairing/PairingService`                                  | pair/startPairing in adapter                                            | orchestrates driver + cert store + repo             | HIGH          | 90%             |
| `remote/RemoteCommandService` (`RemoteCommandRouter`)     | sendCommand/sendText                                                    | queues + emits metrics events                       | HIGH          | 90%             |
| `voice/VoiceSessionService`                               | startAssistantVoice/chunk/stop + **PCM encoder moved out of `App.tsx`** | session lifecycle + bit-exact encode                | HIGH          | 90%             |
| `metrics/CommandMetricsService`                           | `metrics.ts`                                                            | already mostly pure — drop singleton, add interface | MEDIUM        | 90%             |
| `updater/UpdateChecker` (`IReleaseSource`)                | GitHub fetch half of `updater.ts`                                       | `latestRelease(): ReleaseInfo`                      | HIGH          | 90%             |
| `updater/MacUpdateInstaller`                              | install/rollback half                                                   | uses `IFileSystem`, `IShellRunner`                  | HIGH          | 90%             |
| `updater/UpdateStateMachine`                              | the `updaterStatus` object                                              | pure reducer over events                            | HIGH          | 95%             |
| `app/AppFacade`                                           | `GoogleTvAdapter`                                                       | composes services; only thing `main.ts` touches     | MEDIUM        | 80%             |

### Electron shell (`src/main/**`) — kept tiny, integration-tested only

- `main.ts` — window/tray/menu/shortcut/single-instance.
- `ipc/router.ts` — generated from a single `ipcContract.ts` so `preload.ts`
  and handler registration can't drift.
- `presenters/UpdaterDialogs.ts` — moves `dialog.showMessageBox` calls out of
  `updater.ts`. Updater service emits events; presenter renders them.
- `electron-impls/` — `ElectronPathProvider`, `ElectronShellRunner`,
  `ElectronDialogPresenter`, `ElectronAutostart`.

### Renderer (`src/renderer/**`) — restructured

```
renderer/
  api/           gtvRemote client wrapper + React hooks
                 useBootstrap, useDevices, useUpdater, useRemoteSession
  state/         minimal store (Zustand or just useReducer) — no biz logic
  features/
    devicePicker/  DevicePicker, DiscoveredList, SavedList
    pairing/       PairingScreen, CodeInput
    remote/        DPad, MediaControls, KeyboardBindings
    voice/         AssistantButton (delegates audio to backend)
    updater/       UpdaterPanel, RollbackPanel
    diagnostics/   MetricsPanel (debug only)
  ui/            primitives: Icon, Card, Button, Pill
  App.tsx        ≤ 200 lines: routes between feature screens
  main.tsx
```

### Shared (`src/shared/**`)

- `types.ts` — DTOs only.
- `ipcContract.ts` — **NEW**, single source of truth for IPC channels.
- `events.ts` — **NEW**, push-event contract; lets us delete the 1.5s poll.

---

## 3. Universal-remote direction (Apple TV, then later devices)

The same interfaces that make Google TV testable are exactly the seams Apple
TV plugs into. **The refactor is a prerequisite for Apple TV, not an
alternative to it.**

### Per-device deltas vs Android TV

| Concern   | Android/Google TV (current)     | Apple TV (MRP)                                                                            |
| --------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| Discovery | mDNS `_androidtvremote2._tcp`   | mDNS `_mediaremotetv._tcp` + `_companion-link._tcp` + `_airplay._tcp`                     |
| Transport | TLS + length-prefixed protobuf  | TCP + HAP/SRP pairing → Chacha20-Poly1305 framed protobuf (MRP); Companion for newer tvOS |
| Pairing   | 6-digit code, RSA cert exchange | 4-digit SRP-6a PIN → Ed25519 long-term creds                                              |
| Crypto    | TLS handshake, self-signed cert | SRP-6a → HKDF → Curve25519 → Chacha20-Poly1305 (per-message AEAD)                         |
| Identity  | MAC address                     | AirPlay unique identifier                                                                 |
| Voice     | Android TV voice protobuf       | Siri via Companion link (opus)                                                            |
| Node lib? | `androidtv-remote` (in use)     | none mature — see decision in §3.2                                                        |

### 3.1. `types.ts` additions (additive, no breaking renames)

```ts
export type DeviceKind = 'androidtv' | 'appletv'; // open-ended union

export interface SavedDevice {
  // existing fields…
  kind: DeviceKind; // default 'androidtv' for legacy data
  appleTvDeviceId?: string;
  appleTvCredentials?: 'mrp' | 'companion' | 'airplay';
}

export interface DiscoveredDevice {
  // existing fields…
  kind: DeviceKind;
  appleTvServices?: ('mediaremotetv' | 'companion-link' | 'airplay')[];
}

// RemoteCommand stays UNCHANGED — that's the whole point.
export type AppleTvOnlyCommand = 'siri' | 'control-center' | 'app-switcher';
```

A migration step in `DeviceRepository` stamps existing records with
`kind: 'androidtv'` on first read.

### 3.2. `pyatv` vs pure-TS — decided per PR-8b spike

- **(A) TS port of needed subset of `pyatv`** — most maintainable; ~3–5k LOC.
- **(B) Bundle `pyatv` sidecar binary** invoked over stdio JSON-RPC — fastest;
  +15–25 MB DMG.
- **(C) Hybrid** — ship B for MVP, migrate driver-by-driver to A.
  **Recommended.**

### 3.3. Driver contract (used by all device kinds)

```ts
export interface IPairingDriver {
  readonly kind: DeviceKind;
  start(host: string, opts: PairingStartOpts): Promise<PairingHandle>;
  submitCode(handle: PairingHandle, code: string): Promise<PairingResult>;
  abort(handle: PairingHandle): Promise<void>;
}

export interface IRemoteSessionDriver {
  readonly kind: DeviceKind;
  connect(device: SavedDevice): Promise<RemoteSessionHandle>;
  send(handle: RemoteSessionHandle, cmd: RemoteCommand): Promise<void>;
  sendText(handle: RemoteSessionHandle, text: string): Promise<void>;
  startVoice?(handle: RemoteSessionHandle): Promise<VoiceSession>;
  disconnect(handle: RemoteSessionHandle): Promise<void>;
}
```

### 3.4. Hard parts to know about up front

1. **No mature Node MRP library** — see §3.2.
2. **SRP-6a + Chacha20 are easy to get almost right and silently wrong.** Use
   `fast-srp-hap` + `@stablelib/chacha20poly1305`; do not hand-roll.
3. **mDNS dedupe** across 3 service types per Apple TV — add to
   `DeviceRegistry.reconcile`.
4. **Notarization size budget** if we bundle `pyatv`.
5. **UX honesty in README** — list supported / unsupported Apple features.

---

## 4. Testing strategy

**Tooling**: `vitest` + `@vitest/coverage-v8`, `nock` for GitHub API, fake
`tls`/`net` modules for transport tests, Playwright (optional) for Electron
smoke. Per-package coverage gates in CI, ratcheted up per PR.

| Package                | Target    | Mandatory test types                                                                                                   |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `backend/protocol/**`  | ≥ 98%     | golden-file encode/decode (hex fixtures captured from real TV), property tests for cert key material                   |
| `backend/transport/**` | ≥ 95%     | mock `tls.connect`, partial reads, mid-frame disconnects, drain backpressure, retry semantics                          |
| `backend/pairing/**`   | ≥ 95%     | full FSM via fake `IPairingChannel`: happy path, wrong code, mid-flow disconnect, cert-rejected, restart-after-failure |
| `backend/discovery/**` | ≥ 90%     | recorded `dns-sd` stdout fixtures into parser; no subprocess in tests                                                  |
| `backend/devices/**`   | ≥ 95%     | identity-matching matrix: MAC vs cast vs host vs fingerprint, IP-change migration                                      |
| `backend/voice/**`     | ≥ 90%     | bit-exact PCM encode vs reference WAV fixture                                                                          |
| `backend/metrics/**`   | ≥ 90%     | event timelines through reducer; snapshot assertions                                                                   |
| `backend/updater/**`   | ≥ 90%     | `nock` GitHub + temp-dir fs fixture for install/rollback                                                               |
| `main/**`              | not gated | one Playwright smoke: app boots, IPC roundtrip, window shows                                                           |
| `renderer/**`          | ≥ 60%     | React Testing Library; backend mocked via `gtvRemote` fake                                                             |

**Contract tests** for every driver:

```ts
// src/backend/__tests__/pairingDriver.contract.ts
export function pairingDriverContract(makeDriver: () => IPairingDriver) {
  it('emits PairingResult on correct code', async () => { … });
  it('rejects invalid code with retryable error', async () => { … });
  it('aborts cleanly mid-flow', async () => { … });
  it('does not leak credentials on failure', async () => { … });
}
pairingDriverContract(() => new AndroidTvPairingDriver(fakeDeps));
pairingDriverContract(() => new AppleTvPairingDriver(fakeDeps));
```

**Golden fixtures live in `src/backend/protocol/<kind>/__fixtures__/`** —
captured once on a real device, then run forever in CI without one. This is
how "the pairing flow must never regress" becomes CI-enforceable.

---

## 5. PR chain

All PRs land on `main`. Titles use the repo convention:
`[risk-level] [NO-JIRA] type: description`. Each PR is independently
shippable and keeps CI green.

### Group A — Refactor foundation (must finish before any Apple TV work)

| #      | Title (proposed)                                                                      | Branch                            | Scope                                                                                                                                                                                                                                                   | Risk   |
| ------ | ------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PR-1   | `[low-risk] [NO-JIRA] chore: scaffold backend layer + vitest harness`                 | `refactor/01-harness`             | Add `src/backend/` skeleton, `tsconfig.backend.json`, `vitest` + `@vitest/coverage-v8`, `npm test`, `npm run coverage`, ESLint `no-restricted-imports` rules enforcing the layering from §1, CI step running tests on every push. Zero behavior change. | low    |
| PR-2   | `[low-risk] [NO-JIRA] refactor: extract pure protocol modules`                        | `refactor/02-protocol`            | Move `src/main/device/protocol/*` → `src/backend/protocol/androidtv/{pairing,remote,certificate}/`. Add `__fixtures__/` with golden encode/decode hex frames captured from a real Google TV. First batch of tests (≥95% on these files).                | low    |
| PR-3   | `[medium-risk] [NO-JIRA] refactor: extract transport + cert store`                    | `refactor/03-transport`           | Split `androidTvRemote.ts` into `transport/framed-tls/FramedTlsTransport.ts`, `remote/androidTvRemoteDriver.ts`, `devices/credentials/androidTvCertStore.ts`. Inject `ITlsConnector`. Fake-socket tests for backpressure, partial reads, disconnects.   | medium |
| PR-4   | `[medium-risk] [NO-JIRA] refactor: extract discovery + device repo + registry`        | `refactor/04-devices`             | `DeviceRepository` (over `IFileSystem`), `DeviceRegistry` (the identity-matching matrix from `googleTvAdapter.runDeviceScan/saveDevice`), `DiscoveryService` + `androidTvDiscovery` with `dns-sd` stdout fixtures.                                      | medium |
| PR-5   | `[medium-risk] [NO-JIRA] refactor: extract pairing/remote/voice services + AppFacade` | `refactor/05-services`            | `PairingService`, `RemoteCommandService`, `VoiceSessionService` (PCM helpers moved out of `App.tsx`). `AppFacade` composes everything and replaces `GoogleTvAdapter`. `main.ts` now wires the facade.                                                   | medium |
| PR-6   | `[medium-risk] [NO-JIRA] refactor: extract updater services + dialog presenter`       | `refactor/06-updater`             | `UpdateChecker` + `MacUpdateInstaller` + `UpdateStateMachine` (pure reducer). Dialogs become `IDialogPresenter` calls; Electron impl in `src/main/presenters/`. `nock`-based tests for rate limits, abort timeouts, rollback recovery.                  | medium |
| PR-7   | `[low-risk] [NO-JIRA] refactor: unify IPC contract + replace polling with events`     | `refactor/07-ipc-contract`        | `src/shared/ipcContract.ts` as single source of truth. Helpers for `preload.ts` and `ipc/router.ts`. Compile-time check that every channel exists in both halves. Add event channel; delete `setInterval(getUpdaterStatus, 1500)` in renderer.          | low    |
| PR-7.5 | `[low-risk] [NO-JIRA] refactor: introduce driver interfaces (no behavior change)`     | `refactor/07.5-driver-interfaces` | Rename `protocol/`→`protocol/androidtv/`, introduce `IPairingDriver` / `IRemoteSessionDriver` / `IDiscoveryProvider`. Pure interface extraction. Locks the seams for Group C.                                                                           | low    |
| PR-8   | `[medium-risk] [NO-JIRA] refactor: decompose renderer into features`                  | `refactor/08-renderer`            | Split `App.tsx` into `features/` layout from §1. Each feature ≤ 250 lines. Hooks `useRemoteSession`, `useUpdater`, `useDevices`. Cut `styles.css` from 1,103 lines via per-feature modules.                                                             | medium |
| PR-9   | `[low-risk] [NO-JIRA] chore: turn on coverage gates + boundary lint`                  | `refactor/09-gates`               | Coverage thresholds per §4. `eslint-plugin-boundaries` to make layering enforceable. Playwright smoke for Electron startup + IPC roundtrip.                                                                                                             | low    |
| PR-10  | `[low-risk] [NO-JIRA] docs: ARCHITECTURE.md + DEVELOPMENT.md updates`                 | `refactor/10-docs`                | `ARCHITECTURE.md` with the diagram and responsibility table. `DEVELOPMENT.md` updated with `npm test`, fixture capture instructions, layering rules.                                                                                                    | low    |

### Group B — Quick wins (independent, can be slipped between PRs)

| #    | Title                                                                               | Branch               | Scope                                                                                                                        | Risk |
| ---- | ----------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---- |
| QW-1 | `[low-risk] [NO-JIRA] refactor: move PCM helpers out of App.tsx`                    | `qw/pcm-shared`      | `convertFloat32ToPcm16` + `downsampleTo8kMono` + `toBase64` → `src/shared/audio.ts` with unit tests.                         | low  |
| QW-2 | `[low-risk] [NO-JIRA] refactor: unify IPC channel names behind CHANNELS const`      | `qw/channels-const`  | `src/shared/ipcChannels.ts` constants used by both sides. Pre-cursor to PR-7.                                                | low  |
| QW-3 | `[low-risk] [NO-JIRA] refactor: drop module-level singletons in favor of factories` | `qw/factories`       | `androidTvRemoteBridge` and `commandMetricsStore` exported as factory functions. Seams for tests, even before full refactor. | low  |
| QW-4 | `[low-risk] [NO-JIRA] test: golden encode tests for remoteProtocol`                 | `qw/protocol-golden` | 5 golden tests + first `vitest` invocation (parallel to PR-1; mergeable independently).                                      | low  |

### Group C — Universal remote (Apple TV) — starts after Group A is merged

| #     | Title                                                                       | Branch                      | Scope                                                                                                                                                                                                   | Risk   |
| ----- | --------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PR-8a | `[low-risk] [NO-JIRA] feat(discovery): detect Apple TV devices`             | `feature/appletv-discovery` | `appletvDiscovery.ts` (mDNS), surfaced in device picker as greyed "pairing not yet supported".                                                                                                          | low    |
| PR-8b | `[high-risk] [NO-JIRA] feat(pairing): Apple TV SRP/HAP pairing driver`      | `feature/appletv-pairing`   | `AppleTvPairingDriver` implementing `IPairingDriver`. SRP-6a + HKDF + Curve25519 via `fast-srp-hap` and `@stablelib/chacha20poly1305`. `appleTvKeyStore`. Feature-flagged. Full contract-test coverage. | high   |
| PR-8c | `[medium-risk] [NO-JIRA] feat(remote): Apple TV MRP remote driver (basic)`  | `feature/appletv-remote`    | `AppleTvRemoteDriver` mapping `RemoteCommand` to MRP frames. Renderer's existing buttons "just work".                                                                                                   | medium |
| PR-8d | `[medium-risk] [NO-JIRA] feat(voice): Apple TV Siri via Companion link`     | `feature/appletv-siri`      | Reuses `VoiceSessionService`; Siri-specific opus encoder.                                                                                                                                               | medium |
| PR-8e | `[low-risk] [NO-JIRA] feat(remote): Apple TV extras + capability-driven UI` | `feature/appletv-extras`    | Control Center, App Switcher, AirPlay now-playing. UI buttons shown only when `capabilities.supports.includes('siri')` etc.                                                                             | low    |

### Group D — Optional follow-ups (post-Apple TV)

- Product rename strategy (`GTV Remote` → `OmniRemote` or similar) — pure docs PR.
- Roku driver (`_roku-rcp._tcp`).
- LG webOS driver (websocket-based, easier than Apple TV).
- Samsung Tizen driver (websocket + token).
- Fire TV (Android TV protocol, mostly free).
- Chromecast (cast v2 protocol).

---

## 6. Dependency graph between PRs

```
PR-1 ── PR-2 ── PR-3 ── PR-4 ── PR-5 ── PR-6 ── PR-7 ── PR-7.5 ── PR-8 ── PR-9 ── PR-10
   │       │       │       │       │       │
   │       │       │       │       │       └──> (optional) QW-2 ── PR-7 (subsumed)
   │       │       │       │       └──> QW-1 (independent, but easier on top of PR-5)
   │       │       └──> QW-3 (independent)
   │       └──> QW-4 (independent — golden tests on the OLD location, moved by PR-2)
   │
   └── (after PR-7.5)
                                                                     │
                                            ┌────────────────────────┘
                                            ▼
                                   PR-8a ── PR-8b ── PR-8c ── PR-8d ── PR-8e
                                            (PR-8b is the high-risk one)
```

**Strict ordering** required for:

- PR-1 before everything (test harness).
- PR-2 before PR-3 (codec must live in `backend/` before transport extracts it).
- PR-3 before PR-5 (services depend on transport interfaces).
- PR-7 before PR-8 (renderer split needs the event channel to remove polling).
- PR-7.5 before any of PR-8a…e (driver interfaces must exist).

**Looser dependencies** that let us parallelize (see §7):

- PR-6 (updater) is **independent of PR-2…PR-5** — touches only
  `src/main/updater.ts` and a new `src/backend/updater/`. Can run in parallel
  with the device-side refactor.
- PR-8 (renderer split) shares only `src/renderer/**` with no other PR after
  PR-7 lands. Can start as soon as PR-7 is in.
- QW-1…QW-4 are all leaf changes — slot them into any worktree.
- PR-8a (Apple TV discovery only) is touch-isolated to a new file plus a
  one-line surface in the picker — can be done alongside PR-9/PR-10.

---

## 7. Execution strategy — wave-based parallel worktrees (AI-driven)

This section is the runbook. The AI (Rovo Dev) executes; the human reviews
PRs. The strategy is optimized for **parallel throughput bounded by the
dependency DAG**, not for human cognitive bandwidth.

### 7.0. Scope lock for this round

- **In scope**: Group A (PR-1 → PR-10) and the slot-anywhere Quick Wins
  (QW-1 → QW-4). Refactor only. **Google TV behavior must not regress.**
- **Out of scope**: Group C (Apple TV, PR-8a → PR-8e) and Group D
  (Roku/webOS/Tizen/Fire TV/Chromecast/rename). These remain documented
  above as a future milestone; **no code or worktrees are created for them
  in this round.**
- **Cleanup obligation**: when the refactor is fully merged, the script
  `bin/wave.sh` and any remaining worktrees / shadow branches MUST be
  deleted. This file (`REFACTOR_PLAN.md`) can stay or be archived under
  `docs/` per the reviewer's preference.

### 7.1. Operating principles

1. **Wave-based execution.** PRs run in waves. Every PR inside a wave is
   conflict-free with every other PR in that wave and depends only on PRs
   from earlier waves. Between waves we merge to `main` and rebase the next
   wave.
2. **One stable rebase base + ephemeral feature worktrees.** The primary
   checkout stays on `main` and never has edits. Each PR gets its own
   worktree, named `gtv.<short-id>` (e.g. `gtv.r02-protocol`,
   `gtv.qw1-pcm`).
3. **Hardlink-shared `node_modules`.** Per-worktree symlinks to the
   primary's `node_modules` avoid the ~30–90 s / ~400 MB per-worktree
   reinstall tax. Per-worktree `.vite-cache` so concurrent dev servers
   don't collide.
4. **Auto-rebase on every `main` merge.** After any merge to `main`, every
   active worktree is rebased onto `origin/main`. Conflicts are resolved
   immediately, not stacked.
5. **Per-PR budget.** Each PR is **≤8 commits, ≤600 LOC net diff**
   (excluding pure renames/moves, which Git tracks separately). If a PR
   busts the budget, it gets split.
6. **Shadow branches for cross-cutting work.** Two long-lived shadow
   branches that other PRs rebase against:
   - `shadow/fixtures` — golden encode/decode hex frames captured from a
     real Google TV, merged early with PR-2.
   - `shadow/contracts` — `ipcContract.ts` + `events.ts` + driver
     interfaces, merged with PR-7 / PR-7.5.
7. **CI optimization (one-time)**:
   - Matrix `lint` / `typecheck` / `test` in `.github/workflows/ci.yml` so
     they run in parallel per PR (~40% wall-clock win).
   - `pull_request.paths` filters so renderer-only PRs skip the Electron
     build and updater-only PRs skip renderer tests.
8. **Per-PR "Google TV non-regression gate"** (the testing-proofing
   requirement): every PR must keep the following CI checks green, no
   exceptions:
   - **Golden codec tests** for `protocol/androidtv/pairing` and
     `protocol/androidtv/remote` (byte-exact encode + decode of captured
     fixtures).
   - **Transport contract tests** for `FramedTlsTransport` against a fake
     TLS socket (partial reads, drain backpressure, mid-frame
     disconnect).
   - **Pairing FSM tests** — happy path + invalid code + mid-flow
     disconnect + cert-rejected + restart-after-failure.
   - **Device-registry identity-matching matrix** — MAC vs cast vs host vs
     fingerprint vs IP-change migration.
   - **Smoke roundtrip** — a headless integration test that wires the
     real `DeviceRepository` + a stub `IRemoteSessionDriver` + the real
     `AppFacade` and asserts a "scan → pair → connect → send 'up' →
     disconnect" sequence completes without error.
     These checks are introduced incrementally (golden tests with PR-2,
     transport tests with PR-3, etc.) and once added they are **always
     required** on every subsequent PR.

### 7.2. Wave breakdown

| Wave       | PRs in this wave (run in parallel)                            | Depends on | Why these are conflict-free                                                                                                                                              |
| ---------- | ------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Wave 0** | PR-1                                                          | —          | Solo; introduces `src/backend/` + `vitest`. Blocks everything.                                                                                                           |
| **Wave 1** | PR-2, QW-3, QW-4                                              | PR-1       | PR-2 touches `src/main/device/protocol/**`; QW-3 touches singleton exports in `androidTvRemote.ts` and `metrics.ts`; QW-4 adds tests in `src/backend/`. No file overlap. |
| **Wave 2** | PR-3, PR-6                                                    | Wave 1     | PR-3 owns `androidTvRemote.ts`; PR-6 owns `updater.ts`. Disjoint corners.                                                                                                |
| **Wave 3** | PR-4, QW-1, PR-7                                              | Wave 2     | PR-4 owns `discovery.ts` + half of `googleTvAdapter.ts`; QW-1 moves 3 PCM helpers out of `App.tsx`; PR-7 owns `preload.ts` + IPC half of `main.ts`. Disjoint.            |
| **Wave 4** | PR-5 (solo)                                                   | Wave 3     | PR-5 deletes `googleTvAdapter.ts` and rewires `main.ts` to use `AppFacade`. **Must be solo** — too much surface overlap.                                                 |
| **Wave 5** | PR-7.5, PR-8, PR-9                                            | Wave 4     | PR-7.5 = pure interface rename (`protocol/` → `protocol/androidtv/`); PR-8 = `src/renderer/**` split; PR-9 = CI gate config. Disjoint.                                   |
| **Wave 6** | PR-10 (solo)                                                  | Wave 5     | Docs-only.                                                                                                                                                               |
| **Wave 7** | _(Apple TV — deferred to future milestone, not executed now)_ | Wave 6     | Not in scope.                                                                                                                                                            |

**Wall-clock collapse**: 15 sequential PRs → **7 waves**. Group C deferred.

### 7.3. `bin/wave.sh` — worktree automation

A small Bash helper (committed at `bin/wave.sh`, deleted at the end of the
refactor) drives the per-wave plumbing. Supports four subcommands:

| Subcommand                                      | What it does                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `bin/wave.sh start <wave-num> <branch-name>...` | Creates one worktree per branch in `../gtv.<short>`, symlinks `node_modules`, isolates `.vite-cache`.                   |
| `bin/wave.sh rebase`                            | For every active `gtv.*` worktree, runs `git fetch origin && git rebase origin/main`. Halts on conflict for manual fix. |
| `bin/wave.sh status`                            | Prints active worktrees with branch, ahead/behind, dirty status.                                                        |
| `bin/wave.sh end <branch-name>...`              | Removes the named worktrees and deletes the local branches (after merge).                                               |

The script is intentionally thin — `git worktree` does the heavy lifting.
See the script header for full usage and the cleanup section below.

### 7.4. Per-wave commands (example: Wave 1)

```bash
# At the start of the wave (one command):
bin/wave.sh start 1 refactor/02-protocol refactor/qw3-factories refactor/qw4-golden

# Work happens in three parallel worktrees:
#   ../gtv.r02-protocol/
#   ../gtv.qw3-factories/
#   ../gtv.qw4-golden/

# Push and open PRs from each. After all three merge to main:
bin/wave.sh end refactor/02-protocol refactor/qw3-factories refactor/qw4-golden

# Rebase whatever's in flight (idempotent):
bin/wave.sh rebase
```

### 7.5. Cleanup at end of refactor

When Wave 6 (PR-10) merges and the refactor is complete:

```bash
# Remove any lingering worktrees
git worktree list | awk '/gtv\./ {print $1}' | xargs -n1 git worktree remove
git worktree prune

# Delete shadow branches if they still exist locally / on origin
git branch -D shadow/fixtures shadow/contracts 2>/dev/null || true
git push origin --delete shadow/fixtures shadow/contracts 2>/dev/null || true

# Remove the script itself
git rm bin/wave.sh
git commit -m "[low-risk] [NO-JIRA] chore: remove worktree helper after refactor"
```

`REFACTOR_PLAN.md` itself can be deleted, archived to `docs/`, or kept at
the repo root — reviewer's call at that point.

### 7.6. Risk register for the refactor

| Risk                                                          | Likelihood        | Mitigation                                                                                                                                                                                               |
| ------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A PR silently breaks Google TV pairing                        | Medium            | §7.1 #8 — golden + FSM + contract tests, all required on every PR.                                                                                                                                       |
| Cert-migration regression on IP change                        | Medium            | PR-4 ships a dedicated identity-matrix test suite; PR-3 covers cert store I/O.                                                                                                                           |
| Updater rollback bricks an installed app                      | Low (still scary) | PR-6 isolates `MacUpdateInstaller` behind `IShellRunner` + `IFileSystem` and exercises rollback against a temp-dir fixture. Manual smoke on a dev machine before tagging the release that includes PR-6. |
| `androidtv-remote` upstream change breaks `require()` in PR-3 | Low               | Pin the version; transport tests use fakes, not the real lib.                                                                                                                                            |
| PR-8 (renderer split) introduces a UX regression              | Medium            | RTL tests for each feature folder + a Playwright smoke that walks "scan → pair → connect → press up."                                                                                                    |
| Worktree state corruption mid-wave                            | Low               | `bin/wave.sh status` is run before every commit batch; primary checkout is read-only.                                                                                                                    |

### 7.7. Definition of "wave complete"

A wave is complete when **all** of the following are true:

1. Every PR in the wave is **merged to `main`** (squash or rebase per repo
   convention).
2. `main` CI is green on the merge commit.
3. The §7.1 #8 non-regression suite passes on `main`.
4. Any worktrees from the wave are removed via `bin/wave.sh end`.
5. The next wave's worktrees have been rebased onto the new `main`.

---

## 8. Definition of done for the whole effort

- `src/backend/**` has **no `electron` / `react` imports** (ESLint-enforced).
- `src/main/**` is `<800 LOC` total (down from ~2,800).
- `src/renderer/App.tsx` is `≤200 LOC` (down from 2,121).
- `npm test` runs in `<10s` locally; `npm run coverage` produces an
  artifact; CI fails if backend coverage drops below per-package thresholds.
- One Playwright smoke test boots the packaged app and exercises the IPC
  surface end-to-end.
- Apple TV pairing + basic remote works against a real tvOS 17+ device, with
  contract tests + golden MRP fixtures in CI.
- `README.md` lists supported devices as a matrix; product positioning is
  "universal remote" rather than "Google TV remote."
