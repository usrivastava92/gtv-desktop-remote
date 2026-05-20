# Architecture

> Last updated: Wave 18 of the 2026 refactor. See git log for full history.

## Overview

GTV Desktop Remote is an **Electron desktop app** with three tiers. The hard
rule is that dependencies only flow inward — never outward:

```
src/renderer/          ← React (UI only, talks to main via IPC)
       │
       │  window.gtvRemote (typed IPC bridge)
       ▼
src/main/              ← Electron shell (thin: app lifecycle, IPC router)
       │
       │  direct import (GoogleTvAdapter → AppFacade)
       ▼
src/backend/           ← Pure Node (services, ports, codecs — no Electron)
```

---

## Layer responsibilities

### `src/renderer/` — Thin React shell

| Module                   | Purpose                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `App.tsx`                | Root component (~1,867 LOC; further decomposition is ongoing)                   |
| `hooks/useUpdaterStatus` | Owns updater status state + push subscription                                   |
| `hooks/useDeviceScanner` | Owns device discovery state + scan handler                                      |
| `hooks/useRemoteSession` | Owns command queue, busy state, keyboard map                                    |
| `hooks/usePairingFlow`   | Owns pairing state variables                                                    |
| `lib/pure.ts`            | Pure formatting/event helpers (tested)                                          |
| `lib/deviceSelection.ts` | MAC-first identity matching (tested, mirrors backend DeviceRegistry)            |
| `lib/remoteCommands.ts`  | Keyboard command map + burst constants                                          |
| `api.ts`                 | `getDesktopApi()` accessor — the **only** place that touches `window.gtvRemote` |

**Hard rules (enforced by ESLint `no-restricted-imports`):**

- `src/renderer/**` → **cannot** import from `src/backend/**`, `src/main/**`, or `electron`
- Talk to main **only** through `getDesktopApi()` → `window.gtvRemote`

---

### `src/main/` — Electron shell (kept thin)

| Module                            | Purpose                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `main.ts`                         | Window, tray, menu, global shortcut, IPC router (delegates to GoogleTvAdapter)         |
| `preload.ts`                      | IPC bridge — exposes typed `window.gtvRemote` using channels from `shared/ipcContract` |
| `device/googleTvAdapter.ts`       | Composition root for device logic (delegates to `src/backend/`)                        |
| `device/androidTvRemote.ts`       | TLS socket + NativeRemoteClient (session lifecycle, cert migration)                    |
| `device/androidTvRemote.types.ts` | Types + constants extracted from `androidTvRemote.ts`                                  |
| `device/discovery.ts`             | mDNS via `dns-sd` subprocess                                                           |
| `updater.ts`                      | GitHub release download + install + rollback (pure state via `dispatchUpdaterEvent`)   |
| `logger.ts`                       | File logger using `app.getPath('logs')`                                                |
| `metrics.ts`                      | Command metrics (uses `IMetricsRecorder` port)                                         |

---

### `src/backend/` — Pure Node, no Electron, no React

All modules are port-and-adapter style: each directory has a clean
interface (`I*`) and a production implementation. Tests use in-memory fakes.

| Module                                   | Purpose                               | Coverage target |
| ---------------------------------------- | ------------------------------------- | --------------- |
| `core/fileSystem`                        | `IFileSystem` port (fs operations)    | — (port only)   |
| `core/logger`                            | `ILogger` port + `createNodeLogger()` | —               |
| `core/clock`                             | `IClock` port + `createSystemClock()` | —               |
| `core/pathProvider`                      | `IPathProvider` port                  | —               |
| `core/runtimeConfig`                     | `IRuntimeConfig` port                 | —               |
| `protocol/androidtv/pairing`             | Protobuf pairing codec (pure)         | ≥95%            |
| `protocol/androidtv/remote`              | Protobuf remote/IME codec (pure)      | ≥95%            |
| `protocol/androidtv/certificate`         | node-forge cert/key generator         | ≥90%            |
| `transport/framing/frameParser`          | Varint length-prefix frame parser     | ≥95%            |
| `transport/tls/framedTlsTransport`       | `IFramedTlsTransport` port            | —               |
| `transport/tls/tlsConnector`             | `ITlsConnector` port                  | —               |
| `devices/deviceRepository`               | CRUD over `SavedDevice[]`             | ≥90%            |
| `devices/deviceRegistry`                 | MAC-first identity matching + merge   | ≥95%            |
| `devices/credentials/androidTvCertStore` | Cert persistence                      | ≥90%            |
| `metrics/IMetricsRecorder`               | Port for command dispatch metrics     | —               |
| `metrics/createCommandMetricsStore`      | Production implementation             | ≥80%            |
| `voice/VoiceSessionService`              | Voice session lifecycle               | ≥90%            |
| `updater/updaterStatus`                  | `UpdaterEvent` pure reducer           | 100%            |
| `updater/version`                        | Semver helpers                        | 100%            |
| `app/AppFacade`                          | Composition root (wires all services) | ≥80%            |

**Hard rules (enforced by ESLint `no-restricted-imports`):**

- `src/backend/**` → **cannot** import from `electron`, `react`, `src/renderer/**`, or `src/main/**`
- Cross-cutting concerns go through port interfaces

---

## IPC contract

Defined in `src/shared/ipcContract.ts`. Single source of truth for all channel
names. `preload.ts` and `main.ts` both import from it — any drift is a
compile-time error.

Two channel families:

- `INVOKE_CHANNELS` — request/response (renderer calls main)
- `EVENT_CHANNELS` — push (main broadcasts to renderer)

---

## Google TV non-regression gates

Seven test gates that lock the wire format for Android TV communication.
Any change that breaks one of these breaks CI:

| Gate                 | File                                             | What it locks                        |
| -------------------- | ------------------------------------------------ | ------------------------------------ |
| Protocol codecs      | `protocol/androidtv/pairing.test.ts`             | Protobuf pairing encode/decode       |
| Protocol codecs      | `protocol/androidtv/remote.test.ts`              | Protobuf remote command encode       |
| Cert migration       | `devices/credentials/androidTvCertStore.test.ts` | IP-change cert migration             |
| Identity matching    | `devices/deviceRegistry.test.ts`                 | MAC-first priority matrix (46 tests) |
| IPC channel parity   | `shared/ipcContract.test.ts`                     | Channel name uniqueness + format     |
| Frame parser         | `transport/framing/frameParser.test.ts`          | Varint partial-read parsing          |
| Connection lifecycle | `transport/tls/framedTlsTransport.test.ts`       | Socket event dispatch                |

---

## Key design decisions

**Why `setUpdaterStatus` was deleted (PR-6a → PR-6h)**
The original `updater.ts` mutated a global status object directly. It's now
replaced by `dispatchUpdaterEvent(event)` → `applyUpdaterEvent(state, event)`
(a pure reducer). Every status transition is now a typed event with a test.

**Why `DeviceRegistry` is mirrored in `lib/deviceSelection.ts`**
The renderer's device picker must show exactly the same "paired vs unpaired"
split as the backend's identity matching. Both use the same MAC-first → host
priority matrix, verified by tests in both locations.

**Why `AppFacade` exists but `GoogleTvAdapter` still talks to `androidTvRemote`**
`AppFacade` is the future composition root. The current `GoogleTvAdapter` delegates
to `AppFacade` for repository + voice logic, but still calls `androidTvRemote`
directly for TLS/pairing. Full delegation (cutting `googleTvAdapter.ts` to a
shim) is the next planned milestone.

---

## Future work

- **Apple TV support** — documented in `REFACTOR_PLAN.md` (Group C). Unblocked
  once `AppFacade` is fully wired: add `IRemoteDriver` + `IPairingDriver` per
  device kind.
- **App.tsx decomposition** — `src/renderer/features/` for remote, devices,
  updater, voice features. Renderer hooks are the seam.
- **Coverage** — re-ratchet `vitest.config.ts` thresholds after App.tsx gains
  RTL tests (currently 0% statement coverage on App.tsx).
