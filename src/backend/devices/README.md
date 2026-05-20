# `devices/` — persistence + identity matching

- `DeviceRepository` — CRUD over `SavedDevice[]`, behind `IFileSystem`.
- `DeviceRegistry` — the identity-matching matrix (MAC vs cast vs host vs
  fingerprint vs IP-change migration). ≥95% line coverage required.
- `credentials/` — per-kind credential stores (Android TV cert store now,
  Apple TV keystore in a future milestone).

PR-3 introduces `credentials/androidTvCertStore.ts`. PR-4 introduces
`DeviceRepository` and `DeviceRegistry`.
