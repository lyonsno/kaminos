# Coefficient and Shared-Transmittance Oracle, Anchor 96 R1

Status: complete

This frozen-state assay asks whether the remaining Ridge reconstruction error is
principally missing layer emission/extinction and optical coupling rather than
missing Ridge footprint support. It transplants the exact pre-tone-map
coefficients from the full imported field into one shared running
transmittance, while holding state, camera orbit, admitted rows, positions, and
flow-kernel geometry fixed.

## Result

- One global optical-path scalar was fitted on camera 10 only and reused
  unchanged on the other 20 cameras.
- Held-out mean native RGB MAE falls from `0.0904044` for the current Ridge
  reconstruction to `0.0369031` for Ridge plus Non-Ridge coefficients under
  shared transport, a `59.18%` reduction.
- Every held-out camera improves.
- Ridge emission with Ridge extinction alone reaches `0.0851740` held-out MAE.
  Applying total extinction to Ridge emission alone worsens it to `0.1036991`.
  Missing extinction is therefore not an independent darkening knob: the
  omitted emission coefficients and their extinction must participate in one
  optical stream.

This is strong evidence against baking all authored layers into one inseparable
splat set merely to recover extinction. Preserve layer-specific emission and
extinction attributes, then composite all admitted samples through shared
ordered transmittance. Independently tone-mapped image addition is explicitly
excluded by this assay.

## Source Custody

- Frozen simulator state/frame: `96`
- Imported row count: `1,887,894`
- Sample cap: none
- Dropped rows: `0`
- Candidate authority: `external-native-cell-index-list-v0`
- Fluid SHA-256: `fecde19cccf7859e592a7ef546c46b7c222ef01ade4c5ec1ab4fb8682bf8fa2f`
- Front SHA-256: `fb299905a89392bf46f15d6b30f22873dd0e695daac78d9804ce5013a081be40`
- Controls SHA-256: `ba122038332747804203b4d03c6a5e9bf7b1e5969ec5d1f5ef995d3b5adff5b9`
- Effective capture route/backend: `native-3d-compute-fluid-raymarch-v0` / `WebGPU:apple`
- Greenroom job: `57cbf6b92ac5`

The Greenroom job produced all 316 requested images, a complete capture report,
21 nonblank cameras, and matching replay hashes. Its outer job status is
`failed` because the previous post-capture holdout validator rejected this new
source-authority form after capture completed. Commit `96c593b6` fixes that
validator with positive and tampered-hash contracts. No capture fallback or
partial-output claim is being used.

## Truthful Ceiling

This is a coefficient/extinction transplant assay, not a shipping-renderer
parity claim. It uses 96 camera-depth bins for approximate ordering and a
five-tap quantized projected flow tangent. It is neither exact per-splat order
nor exact full covariance. The visible residual therefore includes this raster
and ordering approximation as well as any genuinely omitted representation.

## Artifacts

- Interactive 21-camera comparator: `index.html`
- Machine-readable receipt and metrics: `report.json`
- Exact complete capture report:
  `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-kneecapper-imported-coefficient-orbit-anchor96-r1/capture-report.json`
- Greenroom outer failure receipt:
  `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-kneecapper-imported-coefficient-orbit-anchor96-r1/report.json`

The comparator contains 189 local image assets covering nine modes across all
21 cameras. It provides camera, left/right mode, and blend controls without an
external asset dependency.
