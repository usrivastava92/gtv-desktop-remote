# `protocol/` — pure codecs per device kind

No I/O. No globals. Every export is a deterministic function over `Buffer`
inputs/outputs (or pure value types), so tests are byte-exact and fast.

PR-2 populates `protocol/androidtv/{pairing,remote,certificate}/` by moving
the existing `src/main/device/protocol/*` files here and adding golden
fixtures captured from a real Google TV.
