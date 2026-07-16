# Kaminos Agent Guidance

## Long-Running Smokes

- Treat agent wakeups as compute, not as a free process monitor. Do not put the
  model in a repeated short polling loop when the running job cannot benefit
  from intervention.
- Give each long-running smoke one durable supervisor. The smoke must write a
  terminal report on success or failure, including the failure phase and last
  trustworthy evidence when it exits before its primary artifact.
- Record requested and effective route, backend, model, kernel, and material
  configuration identity in the report whenever routing or fallback can alter
  the result. Missing, stale, partial, blank, fallback, or cached output must
  fail loud instead of looking authoritative.
- Prefer completion events and meaningful phase transitions over periodic
  model wakeups. A lightweight watcher may inspect process liveness and report
  state, but it should wake the owning agent only for terminal completion,
  failure, a phase transition that permits useful work, or a measured liveness
  anomaly.
- When event delivery is unavailable, choose a coarse recheck interval from
  observed phase duration and the earliest point where intervention could
  matter. Multi-minute GPU jobs should not produce ten-second or thirty-second
  model patrols merely to rediscover that they are still running.
- Continue independent work while the smoke runs when another safe slice is
  available. Do not recursively create polling shells, nested wait sessions,
  or status probes whose only result is another poll decision.
- Keep exhaustive parity and reference-oracle routes as offline acceptance
  gates. Interactive inference and operator workbenches should share the
  accepted runtime kernels while excluding CPU oracles, reference tensors, and
  proof-only readbacks from the serving path.
