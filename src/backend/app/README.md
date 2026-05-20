# `app/`

`AppFacade` is the composition root — the **only** module that
`src/main/main.ts` imports from `src/backend/`. It wires every service
together and exposes the surface that the IPC router calls into.

PR-5 introduces `AppFacade` (replacing `GoogleTvAdapter`).
