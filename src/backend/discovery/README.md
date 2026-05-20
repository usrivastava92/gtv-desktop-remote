# `discovery/` — device discovery

`DiscoveryService` aggregates one provider per device kind. The Android TV
provider shells out to `dns-sd`; tests feed recorded stdout fixtures into
the parser so they never spawn a subprocess.

PR-4 introduces `androidTvDiscovery.ts` and `DiscoveryService`.
