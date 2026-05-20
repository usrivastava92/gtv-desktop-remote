# `core/` — ports for the outside world

Tiny interfaces every other backend module depends on instead of reaching
for Node globals or Electron. Each interface has a production impl (wired
in `app/AppFacade`) and an in-memory fake (in tests).

To be filled in by PR-3 and PR-5.
