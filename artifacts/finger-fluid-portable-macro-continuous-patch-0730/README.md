# Portable Macro Continuous Patch Witness

This bundle exercises the first stable continuous reconstruction route for the
portable macro optical renderer. It compares one source state across continuous,
wet-boundary-clipped, regular-grid-debug, and cyan attribution modes, then
separates fixed-camera source motion from frozen-source camera motion.

## Exact Route

- Requested/effective optical route:
  `kaminos/finger-fluid/portable-macro-screen-space-optics-v0`
- Requested/effective topology route:
  `kaminos/finger-fluid/portable-macro-continuous-patch-v0`
- Effective backend: `webgpu`
- Optical fallback: none
- Topology fallback: none
- Reconstruction:
  `shared-c1-hermite-patch-v0`,
  `analytic-position-derivative-v0`,
  `fragment-signed-wet-margin-aa-v0`

The browser report binds the served HTML, runtime, renderer, and WebGPU core
bytes to this checkout. It rejects a fallback backend, stale/default route,
missing topology identity, blank/partial output, non-dynamic source frames,
non-responsive camera motion, and pre-output failure without a durable report.

## Inspected Comparisons

- `browser/continuous-fixed-camera-source-start.png` and
  `browser/continuous-fixed-camera-source-end.png`: fixed camera, evolving
  producer state. The surface silhouette and broad highlight field move without
  exposing a fixed interior cell diagonal pattern.
- `browser/same-state-regular-grid-debug.png`: preserves the old grid carrier.
  The left silhouette is visibly serrated and the optical field remains
  segmented at cell scale.
- `browser/same-state-wet-boundary-clipped.png`: removes dry grid triangles but
  retains piecewise clipped topology. This separates shoreline clipping from
  continuous position/normal reconstruction.
- `browser/same-state-cyan-debug.png`: exposes the reconstructed carrier without
  optical shading. It is a topology attribution view, not a beauty result.
- `browser/frozen-source-camera-base.png` and
  `browser/frozen-source-camera-moved.png`: frozen producer state, changed
  camera projection. This proves the camera counterfactual is independently
  exercised.

Measured full-canvas deltas:

- fixed-camera source motion: `0.036846`
- regular grid versus continuous: `0.019019`
- clipped versus continuous: `0.012116`
- frozen-source camera motion: `0.032801`

## Visual Disposition

The continuous route materially removes renderer-authored lattice crawl and
fixed cell-diagonal creases from this fixture. The accepted delta is the shared
surface carrier, analytic derivative normals, and fragment-path signed wet
coverage. The result does not claim to repair producer discontinuities,
large-scale water morphology, sparse-fixture art direction, or final terrain
composition. Those remain separate consumer-visible work.

## Invocation

```bash
node finger-fluid-portable-macro-optical-witness.mjs \
  --out-dir artifacts/finger-fluid-portable-macro-continuous-patch-0730/browser \
  --report artifacts/finger-fluid-portable-macro-continuous-patch-0730/browser/report.json \
  --debug-port 9543
```

The interactive smoke remains available at:

`http://127.0.0.1:48220/finger-fluid-portable-macro-optical-witness.html?mode=continuous&time=2.75&paused=1`
