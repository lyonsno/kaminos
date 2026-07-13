# Projected smoke footprint diagnostic

Question: Is the residual regular smoke grid primarily a billboard-orientation defect, a coarse footprint-coverage defect, or a producer-side hierarchy defect?

Result: Projecting the stored axisymmetric 3D covariance is mechanically correct but visually neutral on the current coarse products because their longitudinal/radial radius ratio is nearly one. Increasing only coarse footprint coverage to `1.8` materially softens the regular grid; `2.4` and `3.2` progressively replace it with broad, over-smoothed lobes. Neither the selected fine layer nor the original ungated fine layer restores plume articulation at coverage `2.4`. The renderer can hide the grid, but it cannot reconstruct spatial support discarded by coarse consolidation.

The decisive producer witness is in `support-accounting.json`. Before consolidation, the step-96 coarse product spans `y = -0.9243..0.9242` with mass-weighted `y = 0.3405`. The consolidated product preserves the same `3.298181` coarse extinction mass within packed-float precision but places all 341 anchors in `y = 0.6506..0.8516`, with weighted `y = 0.7043`. Global nearest-anchor mass transfer conserves scalar extinction while collapsing transport geometry into the high-mass band.

## Exact routes

All reports passed with effective route `webgpu-real-field-hierarchical-smoke-motion-v0`, footprint authority `axisymmetric-projected-covariance-v1`, no fallback, no rejected extinction, and distinct captured frame hashes.

| Witness | Fine draws | Total four-instance draws | Visible result |
| --- | ---: | ---: | --- |
| projected default | 0 | 1,380 | no material delta from the corrected camera billboard |
| coarse coverage `1.8` | 0 | 1,380 | regular grid materially reduced; structure retained |
| coarse coverage `2.4` | 0 | 1,380 | broad continuous lobes; early over-smoothing |
| coarse coverage `3.2` | 0 | 1,380 | grid suppressed, but smoke becomes excessively smooth and lumpy |
| gated fine, coverage `2.4` | 3,076 | 4,456 | visually indistinguishable from coarse-only coverage `2.4` |
| ungated fine, coverage `2.4` | 13,880 | 15,260 | visually indistinguishable from coarse-only coverage `2.4` |

Browser timing remains `browser-request-animation-frame-cpu-submit-v0`, not isolated GPU duration. The sampled p50 stayed about `8.3 ms` across this diagnostic and is not used as a performance closure claim.

## Artifacts

- `projected-default.png` and `projected-default-report.json`: covariance projection at the default coarse footprint.
- `coverage-1.8.png`, `coverage-2.4.png`, and `coverage-3.2.png`: coarse-only coverage sweep.
- `fine-gated-coverage-2.4.png`: selected mass-relative fine occupancy enabled.
- `fine-ungated-coverage-2.4.png`: original ungated fine residual enabled.
- `support-accounting.json`: pre- and post-consolidation role bounds, mass, and weighted centroids.

## Decision

Keep projected covariance and explicit route accounting as truthful renderer infrastructure. Do not choose a larger coverage value as the smoke fix. The next producer slice must preserve coarse spatial support while reducing count, using spatially stratified anchors and local-only mass transfer instead of global high-mass anchors.

Does not prove: final smoke appearance, long-horizon decode coherence, flame/smoke depth composition, isolated GPU timing, or the correct stratum scale for the replacement producer.
