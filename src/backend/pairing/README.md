# `pairing/`

`createPairingClient` constructs the LibreControl pairing client with an explicit
TLS transport error listener installed before connection. This lets connection
errors reject the pairing request instead of throwing before promise rejection.
The main-process bridge closes failed pairing clients and closes active pairing
clients when clearing their sessions.

Certificate-bound secret derivation and local hash validation remain owned by
`@librecontrol/google-tv`; this lifecycle fix does not bypass validation or
establish Google TV Streamer compatibility.

See [pairing regression checks](../../../DEVELOPMENT.md#pairing-regression-checks)
for the real-TLS tests, Electron smoke path, and remaining diagnostic prerequisites.
