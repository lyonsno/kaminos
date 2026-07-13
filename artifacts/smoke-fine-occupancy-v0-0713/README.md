# Mass-relative fine smoke occupancy v0

Question: Can a sparse, mass-relative occupancy gate materially reduce emitted fine smoke splats while preserving extinction, adjacent-phase support, and the current moving appearance? Does that reduction remove the residual veil previously attributed to fine occupancy?

Result: Yes for cost, no for the visible veil. At the selected `0.4` ratio, step 96 emits `773` of `3,474` selector-selected fine bins and the held-out learned step 97 emits `642` of `3,403`. Non-emitted fine allocation returns to coarse transport, so both products retain all source extinction with zero rejected mass. Adjacent target phases share `682` fine spatial keys, or `88.23%` of the step-96 emitted set. The four-instance draw envelope falls from `15,260` in the ungated baseline to `4,456`, a `70.80%` reduction.

Direct inspection found no material visual delta among ratios `0.2`, `0.4`, and `0.6`, nor between the selected full route and its matched four-instance coarse-only route. Fine occupancy is therefore a useful cost mechanism, not a visual fix. The residual bead/grid/veil appearance belongs to coarse representation or resolve behavior and remains open.

## Route receipt

- Repo: `/Users/noahlyons/dev/kaminos`
- Worktree: `/private/tmp/kaminos-handy-live-splat-smoke-0713`
- Branch: `cc/handy-live-splat-smoke-0713`
- Capture base: `db0d8eaa5dd2b7a9bfab1547d0c89320423abd45`
- Source frames: `/private/tmp/kaminos-splat-good-basin-full-grid-160-replay96-v1/manifest.json` and `/private/tmp/kaminos-splat-good-basin-full-grid-160-replay97-v1/manifest.json`
- Source route: `native-3d-compute-fluid-raymarch-v0`, deterministic simulator steps 96 and 97, grid 160
- Product route: `authoritative-full-grid-real-smoke-hierarchy-corpus-v0`
- Viewer route: `webgpu-real-field-hierarchical-smoke-motion-v0`
- Backend: `WebGPU:apple`
- Fine gate: `mass-relative-fine-occupancy-v0`, selected ratio `0.4`, no capacity cap
- Temporal authority: `velocity-carried-short-horizon-extrapolation-v0`

Corpus command:

```sh
node scripts/compile-real-smoke-splat-corpus.mjs \
  --frame /private/tmp/kaminos-splat-good-basin-full-grid-160-replay96-v1/manifest.json \
  --frame /private/tmp/kaminos-splat-good-basin-full-grid-160-replay97-v1/manifest.json \
  --out-dir artifacts/smoke-fine-occupancy-v0-0713 \
  --coarse-block-size 8 \
  --fine-block-size 4 \
  --articulation-threshold 0.5 \
  --fine-mass-fraction 0.5 \
  --coarse-anchor-mass-ratio 0.8 \
  --fine-occupancy-mass-ratio 0.4 \
  --instance-count 4 \
  --phase-slot-count 2
```

Durable full-route smoke URL:

```text
http://127.0.0.1:8237/smoke-splat-motion.html?route=webgpu-real-field-hierarchical-smoke-motion-v0&manifest=./artifacts/smoke-fine-occupancy-v0-0713/motion-source.json&instances=4&fine_lod=1&motion_rate=0.16
```

Matched coarse-only diagnostic URL:

```text
http://127.0.0.1:8237/smoke-splat-motion.html?route=webgpu-real-field-hierarchical-smoke-motion-v0&manifest=./artifacts/smoke-fine-occupancy-v0-0713/motion-source.json&instances=4&fine_lod=0&motion_rate=0.16
```

`full-route-witness-report.json` and `coarse-only-witness-report.json` both record the artifact-relative requested manifest, exact requested/effective WebGPU route, no fallback, four instances, eight distinct live frame digests, and zero rejected extinction. Their PNG sequences live under `full-route-frames/` and `coarse-only-frames/`.

## Operating-point sweep

| Ratio | Step-96 target fine | Step-97 learned fine | Shared target keys | Shared fraction | Target total | Learned total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `0.05` | 3,472 | 3,400 | 3,244 | 93.43% | 3,813 | 3,745 |
| `0.10` | 3,234 | 3,121 | 3,014 | 93.20% | 3,575 | 3,466 |
| `0.20` | 2,649 | 2,539 | 2,490 | 94.00% | 2,990 | 2,884 |
| `0.40` | 773 | 642 | 682 | 88.23% | 1,114 | 987 |
| `0.60` | 176 | 75 | 124 | 70.45% | 517 | 421 |
| `0.80` | 36 | 5 | 15 | 41.67% | 386 | 360 |

The `0.4` point is selected for this witness, not installed as a universal default. It captures most of the count reduction before the target/learned phase imbalance and shared-support collapse become severe at `0.6` and above. `sweep-summary.json` preserves all selector, occupancy, allocation-transfer, count, and mass receipts for every point.

## Visual diagnosis

- `sweep-frames/ratio-020-full.png`, `ratio-040-full.png`, and `ratio-060-full.png` are direct full-route captures. The large fine-count sweep does not produce a material appearance change.
- `full-route-frames/frame-003.png` and `coarse-only-frames/frame-003.png` are matched four-instance captures from the selected durable product. Their visible bead/grid/veil character is essentially the same.
- `sweep-frames/baseline-four-coarse-only.png` is the matched-instance causal control used to correct the previous attribution.
- The earlier inference that fine articulation restored the veil compared one coarse-only instance against four full-route instances. That comparison was confounded. The matched four-instance control rejects the inference.

## Important hashes

- `report.json`: `3bb652a0dbac6fa2cce04215aa43c035ad655dc8a6a6e384294daa7be654e6a9`
- `motion-source.json`: `ed6236a1b3d7b0ebc5d87ac8255847b008e037c9e81d8493f52c01adf944006b`
- `sweep-summary.json`: `b217896f650a8c2e9aaedc03527141fe0c0c1e9611045835b9de90fa3b80a7fe`
- `sparse-fine-selector.json`: `fd53aa640ab92681477981ee2ab880b7682a61a8221b4c897db70f3b5fb47971`
- `sim-step-96-target.splats.f32`: `500747b7d78b40f8f7ef37cba1a086406142a854fcbf3466a18bf4f9bc3bc871`
- `sim-step-97-target.splats.f32`: `f8608b599555826f99edafdf2b7ca308fe276d7c3e48b6b64ba3d2ff1689243e`
- `sim-step-97-learned.splats.f32`: `37a5797986e4b4cd35d0a6812748a1953bb23dc3f98065c2b97b96e8e2e98418`
- `full-route-witness-report.json`: `76d5509896d03b74e69a0de3a900f3a32cc3f00184fd70802a42f5293c8ef303`
- `coarse-only-witness-report.json`: `bb4ec2d4e5a741ebb484010d4fc01ea70ad1130bb5a1d5eb6bb88c391ba5cd6a`
- `full-route-frames/frame-003.png`: `7d66d45ba59d08591074ff9a010bbff140c57e8bcbf0ba102e99d27c6c1319aa`
- `coarse-only-frames/frame-003.png`: `de3424506811186d5e615883cc67dc450bd3cb0fbc12925120498dd3208520c6`

## Claim boundary

This evidence proves a deterministic, mass-preserving reduction in emitted fine smoke occupancy on the named adjacent frames, including a held-out learned selector product, and proves that the selected products execute as moving four-instance WebGPU splats without route fallback. It does not prove a visual improvement, final smoke appearance, recurrent neural smoke decode, camera generalization, production GPU cost, or final flame-smoke depth composition. The next appearance target is the coarse footprint/resolve mechanism, not a more aggressive fine threshold.
