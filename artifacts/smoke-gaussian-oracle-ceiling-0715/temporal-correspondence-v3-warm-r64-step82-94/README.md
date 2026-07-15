# Smoke Gaussian Oracle Warm-Start Temporal Receipt

## Verdict

Bounded warm-start continuation is viable on the admitted `r64` tall-plume window. The same checksum-bound Gaussian rows survive `82 -> 92 -> 93 -> 94` without a volumetric-fit penalty, renewed bead segmentation, or visible popping in the inspected orthographic witnesses. This is positive evidence for local temporal correspondence, including one ten-step transition. It is not closure for topology-changing smoke: this fixed-count window exhibited no births, deaths, splits, or merges, and the current warm fitter cannot change active count by construction.

The remaining visible error is the already identified fitter/coverage wall: the proxy reproduces the plume silhouette and broad extinction but smooths away the teacher's internal extinction texture. Nothing in this assay revives the claim that Gaussian support itself is disqualifying.

## Source Authority

- Worktree: `/private/tmp/kaminos-smoke-oracle-ceiling-eater-live-0715`
- Branch: `cc/smoke-oracle-ceiling-eater-live-0715`
- Teachers: `../teacher-sequence-v4-r64-c256k-oneframe/sim-step-82.manifest.json` and `../teacher-sequence-v5-r64-c256k-threeframe/sim-step-{92,93,94}.manifest.json`
- Effective route: `native-3d-compute-fluid-raymarch-v0`
- Prototype: `kaminos-volume-prototype-v0`
- Backend: `WebGPU:apple`
- World authority: `native-volume-grid-world-transform-v0`, bounds `[-1, -1, -1]..[1, 1, 1]`
- Step-82 and step-92 manifests differ only in completed step count and checksum-bound fluid artifact identity; route, controls, camera, renderer, grid, and world-space fields agree.
- Analyzer: `smoke-gaussian-oracle-temporal-correspondence-v0`
- Warm authority: `checksum-bound-prior-artifact-row-index-v0`
- Hidden budget cap: false

## Fail-First Contract

Before inherited correspondence existed, `node tests/smoke-gaussian-oracle-temporal-contracts.mjs` failed at the new assertion because `budgetTransitions[0].inheritedCorrespondence` was absent. After implementation, the focused temporal and fitter contracts pass. The analyzer rejects a warm frame unless its source report path, actual report-byte checksum, source artifact checksum, step linkage, budget count, and residual bound all match the preceding frame.

## Fit Frontier

All fits use every smoke voxel above the explicit `0.000001` threshold, exact active counts `32,64,128`, twelve weighted-k-means iterations, freely positioned anisotropic moments, and an explicit `0.08` world-unit per-transition center bound.

| Step | Fit lineage | SSE 32 | SSE 64 | SSE 128 | Total fit cost |
| --- | --- | ---: | ---: | ---: | ---: |
| 82 | independent seed | 4.665780 | 3.133564 | 2.031231 | 1304.122 ms |
| 92 | warm from 82 | 4.541320 | 3.048303 | 1.986031 | 125.198 ms |
| 92 | independent control | 4.605078 | 3.057104 | 2.011696 | historical report |
| 93 | warm from 92 | 4.410084 | 2.951256 | 1.934509 | 130.383 ms |
| 93 | independent control | 4.538631 | 3.061153 | 2.000254 | historical report |
| 94 | warm from 93 | 4.284515 | 2.857632 | 1.884836 | 129.228 ms |
| 94 | independent control | 4.401003 | 2.961817 | 1.980477 | historical report |

The warm chain improves rather than sacrifices volumetric SSE. At step 94 the reductions versus independent fitting are approximately `2.65%`, `3.52%`, and `4.83%` for `32`, `64`, and `128` splats.

## Correspondence And Topology

| Budget | Worst mean motion | Worst p95 motion | Max motion | Total clipped updates | Max support leakage |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 32 | 0.027837 | 0.072982 | 0.073635 | 0 | 0.125000 |
| 64 | 0.024567 | 0.060940 | 0.080000 | 12 | 0.078125 |
| 128 | 0.018314 | 0.065524 | 0.080000 | 1 | 0.054688 |

Every source-linked row remains present: minimum matched count equals the requested count for all three transitions and all three budgets. Greedy world-space diagnostics independently report zero births, deaths, splits, and merges. Teacher extinction changes are represented exactly by every fit: `-7.205%` over `82 -> 92`, `-2.960%` over `92 -> 93`, and `-3.481%` over `93 -> 94`.

These zero event counts are observations, not a general capability claim. Active count is fixed in this formulation, so a sequence that truly demands birth/death or split/merge remains the next temporal falsification target.

## Visual Inspection

Inspected contact sheets, each laid out as teacher raymarch, Gaussian render, and absolute luma difference for `32`, `64`, and `128` splats:

- `/private/tmp/kaminos-smoke-oracle-ceiling-eater-live-0715/artifacts/smoke-gaussian-oracle-ceiling-0715/render-witness-v5-warm-r64-step82-94/sim-step-82/orthographic-render-contact-sheet.png`
- `/private/tmp/kaminos-smoke-oracle-ceiling-eater-live-0715/artifacts/smoke-gaussian-oracle-ceiling-0715/render-witness-v5-warm-r64-step82-94/sim-step-92/orthographic-render-contact-sheet.png`
- `/private/tmp/kaminos-smoke-oracle-ceiling-eater-live-0715/artifacts/smoke-gaussian-oracle-ceiling-0715/render-witness-v5-warm-r64-step82-94/sim-step-93/orthographic-render-contact-sheet.png`
- `/private/tmp/kaminos-smoke-oracle-ceiling-eater-live-0715/artifacts/smoke-gaussian-oracle-ceiling-0715/render-witness-v5-warm-r64-step82-94/sim-step-94/orthographic-render-contact-sheet.png`

Visible result: the plume remains continuous through the chain with no new bead stack, row-identity pop, or frozen-frame silhouette. The Gaussian result remains smoother and less internally structured than the teacher. These are CPU orthographic single-channel compositor proxies, not the production compositor or hostile native-camera closure.

## Reproduction

Seed command:

```sh
node smoke-gaussian-oracle-fitter.mjs --manifest artifacts/smoke-gaussian-oracle-ceiling-0715/teacher-sequence-v4-r64-c256k-oneframe/sim-step-82.manifest.json --manifest-sha256 689459f05325d4bbd7a1642649aed2a40d645935eec5c7a4703d13e03b245146 --out-dir artifacts/smoke-gaussian-oracle-ceiling-0715/warm-fit-v2-r64-temporal/sim-step-82 --budgets 32,64,128 --max-iterations 12 --density-threshold 0.000001
```

Continuation shape, repeated for the next checksum-bound manifest:

```sh
node smoke-gaussian-oracle-fitter.mjs --manifest <next-manifest> --manifest-sha256 <manifest-sha256> --out-dir <next-fit-dir> --budgets 32,64,128 --max-iterations 12 --density-threshold 0.000001 --warm-start-report <prior-oracle-fit-report.json> --max-center-residual 0.08
```

Temporal analysis:

```sh
node smoke-gaussian-oracle-temporal.mjs --fit-reports artifacts/smoke-gaussian-oracle-ceiling-0715/warm-fit-v2-r64-temporal/sim-step-82/oracle-fit-report.json,artifacts/smoke-gaussian-oracle-ceiling-0715/warm-fit-v2-r64-temporal/sim-step-92/oracle-fit-report.json,artifacts/smoke-gaussian-oracle-ceiling-0715/warm-fit-v2-r64-temporal/sim-step-93/oracle-fit-report.json,artifacts/smoke-gaussian-oracle-ceiling-0715/warm-fit-v2-r64-temporal/sim-step-94/oracle-fit-report.json --out-dir artifacts/smoke-gaussian-oracle-ceiling-0715/temporal-correspondence-v3-warm-r64-step82-94 --budgets 32,64,128 --max-match-distance-multiplier 2.5
```

## Next Evidence Boundary

The next representation-owned temporal assay is adaptive active-count continuation on an authority-selected sequence with genuine support births, deaths, splits, or merges. The present evidence says fixed-count warm correspondence is not the current wall; it does not silently claim that topology-changing continuation has been solved.
