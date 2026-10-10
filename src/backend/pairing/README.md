# `pairing/`

`createPairingClient` constructs the LibreControl pairing client with an explicit
TLS transport error listener installed before connection. This lets connection
errors reject the pairing request instead of throwing before promise rejection.
The main-process bridge closes failed pairing clients and closes active pairing
clients when clearing their sessions.

Certificate-bound secret derivation and local hash validation remain owned by
`@librecontrol/google-tv`; this lifecycle fix does not bypass validation or
establish Google TV Streamer compatibility.

The real-TLS fixture server explicitly trusts the generated client certificate
and requires TLS client authorization. The pairing client retains the Android TV
self-signed server behavior; the tests independently check the certificate-bound
secret and reject a mismatched pairing-code hash.

See [pairing regression checks](../../../DEVELOPMENT.md#pairing-regression-checks)
for the real-TLS tests, Electron smoke path, and remaining diagnostic prerequisites.
