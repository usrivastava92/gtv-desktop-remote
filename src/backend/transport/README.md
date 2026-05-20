# `transport/` — framed socket transports

Connects protocol codecs to real sockets. Behind an `ITlsConnector` port so
tests use fake sockets that simulate partial reads, drain backpressure, and
mid-frame disconnects.

PR-3 introduces `framed-tls/FramedTlsTransport.ts`.
