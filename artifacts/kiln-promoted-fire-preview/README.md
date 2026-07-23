# Promoted Fire Actor Kiln Preview

This evidence exercises the tracked Flamebowl revision through the real Wake Kiln
browser consumer without invoking SHARP or another inference route.

## Invocation

```sh
python3 serve.py 18400
node kiln-promoted-fire-witness.mjs \
  --url http://127.0.0.1:18400/ \
  --out artifacts/kiln-promoted-fire-preview/live/promoted-fire.png \
  --report artifacts/kiln-promoted-fire-preview/live/report.json \
  --settle-ms 7000 \
  --frame-wait-ms 60000
```

## Exact Identity

- Mount: `firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7`
- Basin: `big-raymarch-hero-flamebowl-cotangent-covariance@basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95`
- Policy: `firepolicy-0d0e2ed351051a48ab0b9eaaacbe38c482305f2bd21dc78297be1de50f318d17`
- Engine source: `dcf2ee18a8ed726efde5bf2ae4a8e0f8cd804c10:volume-core.js`
- Engine SHA-256: `fa872e98323fa436a67c83cee340da0b978bb1046d8c7fd495391dc01985acbb`
- Effective splat mode: `kernel_moment_covariance`

The engine source hash matched the effective browser module hash. The actor
completed with `fallbackReason: null`, `inferenceRan: false`, and `routeRef: null`.

## Observed Run

The inspected frame in `live/promoted-fire.png` shows the actor centered beside
the live Firing Station: a blue base, bright yellow-orange fire body, and tall
smoke plume are visible without clipping or Crucible-workspace occlusion. The
pixel witness counted 1,814,474 changed pixels and 1,726,101 lit pixels inside
the 2120 by 1826 canvas region.

The same episode advanced 166 rendered frames and 166 simulation steps before
completion. Its RAF/queue proxy reported 13.89 FPS, 72.0 ms frame p95, 189.6 ms
latest queue completion, and 233.5 ms queue-completion p95 across 13 samples.
These values are explicitly not GPU-exclusive or present latency. WebGPU
timestamp queries were available, but stage timings were not sampled in this
run; `live/report.json` preserves that status instead of projecting a GPU
breakdown.
