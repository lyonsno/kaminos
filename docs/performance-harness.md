# Repeat a performance comparison

Use one saved JSON configuration and one runner for the existing shared Fluid
workbench. The first configuration crosses water rendering present/absent with
standalone scene AO on/off. The solid fixture, camera, drawing buffer and full
particle state remain fixed. Water absent uses the ordinary scene graph with
the fixture's existing helper-ground policy; it submits no water scene capture,
water depth, particle raster, optical composite or resolve.

```sh
node tools/performance-run.mjs \
  --config tools/performance-water-ao.json --repo "$PWD" --port 48517 \
  --browser "$CHROME_FOR_TESTING" --playwright "$PLAYWRIGHT_MODULE" \
  --out "$RESULTS"
```

The caller supplies an independent Chrome for Testing/Chromium executable and
an installed Playwright module. There is no new dependency. `--port` starts and
cleans up an owned server with stores under the output directory. Alternatively
`--url` uses an existing server; its effective checkout and served source hashes
must match `--repo`. The runner owns and closes its own browser in both cases.
`--expected-revision <SHA>` requires that exact clean source for queued runs.
Use a fresh output directory: existing reports are never overwritten.

The config controls the route, camera, viewport/DPR, held simulation step,
warmup frames, measured frames, rounds and named cases. Rounds reverse case
order. Per-case water/AO controls are required; resolution, reflection cutoff,
energy diagnostics and GPU-stage timing controls can override the shared
controls. Unsupported inputs fail rather than being ignored. Keep common
controls fixed when interpreting the water × AO interaction.

Open `comparison.html` in the result directory. It contains case screenshots,
callback and draw-interval P50/P95/P99 and mean FPS. `report.json` records
effective route, browser/source/config identity, dispatch counters, exact
particle hashes and descriptive AO marginal-cost differences by round.
Each case retains every measured frame in JSON and complete before/after
particle observations in V8 files. An absent-water case still retains the
simulation for comparison; it does not dispose the fixture or reset water.

## What the numbers mean

`held-render` measures actual redraw cadence and the ordinary main animation
callback's elapsed wall time at fixed water. It excludes advancing simulation.
Draw intervals include browser scheduling and GPU backpressure; callback time
is not CPU utilization. Display presentation and pure GPU frame duration are
not observed. Existing optional GPU-stage timing is separately controlled;
overlapping stage spans are not additive. The harness does not turn those
metrics into a playing-water FPS claim.

Sampling is opt-in via `kaminos_performance=1`. Without it no harness instance,
water suppression or frame collection is active. In that page,
`window.kaminosPerformance.apply(controls)` and
`sample({frames,warmupFrames})` expose the same adapter used by the runner.
Only actual newly rendered host frames count. Hidden pages, fallback/wrong
devices, changed controls/camera/extent/clock, cached frames, AO execution
mismatch and changed particles/solids fail the comparison.

## Inspect and diagnose failures

`--inspect-only` captures the case views without collecting performance samples.
Its `inspection.html` is a visual control check, not a timing report. Ordinary
visual inspection runs directly. Benchmarks use the shop's serialized GPU
queue; submit the command with exact config/source/output coordinates.

`--fault missing-module` replays the previously observed required-module HTTP404
on the native browser route. The runner writes a failed load report, the exact
failed request and `terminal-signal.json` without producing timing cases.
Reports begin before argument/source/browser setup; failures retain the phase,
last readable runtime and partial frame samples. Cleanup targets only the owned
browser/server. A module error rejects immediately rather than waiting for a
runtime API that cannot appear.
