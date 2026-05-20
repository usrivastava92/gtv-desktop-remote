# `src/backend/`

Pure-Node service layer for GTV Desktop Remote.

**Hard rules** (enforced by ESLint in `eslint.config.ts`):

- This tree MAY NOT import `electron`, `react`, `react-dom`, anything from
  `src/main/**`, or anything from `src/renderer/**`.
- This tree is consumed only by `src/main/**` (composition root) and its own
  tests.
- Every public surface is an interface + a concrete impl, so tests can swap
  in fakes for filesystem, clock, TLS sockets, dialogs, shell, etc.

See `REFACTOR_PLAN.md` at the repo root for the full architecture, the
per-module responsibility table, and the coverage targets.

## Layout

| Folder       | What lives here                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `core/`      | Ports for the outside world: `ILogger`, `IClock`, `IFileSystem`, `IPathProvider`, `IIdGenerator`, `IEventBus`. |
| `protocol/`  | Pure codecs per device kind. `protocol/androidtv/{pairing,remote,certificate}/`. No I/O, no globals.           |
| `transport/` | Framed socket transports. `framed-tls/` for Android TV TLS.                                                    |
| `discovery/` | mDNS-style discovery providers + the `DiscoveryService` aggregator.                                            |
| `devices/`   | `DeviceRepository`, `DeviceRegistry`, per-kind credential stores.                                              |
| `pairing/`   | `PairingService` + per-kind `IPairingDriver` implementations.                                                  |
| `remote/`    | `RemoteCommandRouter` + per-kind `IRemoteSessionDriver` implementations.                                       |
| `voice/`     | `VoiceSessionService` and the PCM encoder (moved out of the renderer).                                         |
| `metrics/`   | `CommandMetricsService` — pure event-sourced metrics.                                                          |
| `updater/`   | `UpdateChecker` + `MacUpdateInstaller` + `UpdateStateMachine`.                                                 |
| `app/`       | `AppFacade` — the single composition root used by `src/main/`.                                                 |
| `__tests__/` | Cross-cutting / contract tests that span multiple folders.                                                     |
