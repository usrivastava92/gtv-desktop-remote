# `metrics/`

`CommandMetricsService` — event-sourced metrics for command dispatch,
transport, and stalls. Already mostly pure in `src/main/metrics.ts`; PR-3
lifts it here and drops the module-level singleton in favor of a
constructor-injected instance.
