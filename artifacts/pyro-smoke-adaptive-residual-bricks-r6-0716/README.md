# R6 Adaptive Residual Brick Smoke Frontier

## Verdict

The coarse-plus-connected-residual-volume decomposition has a strong static representation knee on this basin. One camera-independent R40 parent-mean volume plus 614 complete 4x4x4 residual bricks retaining 98% of source-volume residual energy preserves the native tongue, elevated cavity, side envelope, and back interior support visibly close to the exact R160 participating-media reference. The same persisted selection is used for all four cameras.

At that point, only 1.36% of R160 fine cells are retained after unioning one-cell trilinear halos. Conservative storage is 4.48% of the dense scalar field because the diagnostic charges float64 coarse means and float32 fine values. The CPU hierarchy traversal model charges 34.28-36.30% of dense samples and 5.42-5.54% of dense texture fetches. These are representation and modeled-work results, not measured Apple GPU or production-compositor timing.

This passes the static representation gate and earns an isolated GPU brick-traversal prototype. It does not yet establish a product speedup, temporal stability, update cost, production memory layout, or integration fitness.

## Representation

- Source: exact R160 step-45 physical extinction from the R5 sidecar.
- Coarse body: complete R40 grid; every 4x4x4 parent stores its exact mean extinction.
- Residual: source cell value minus parent mean, ranked by complete-parent squared residual energy.
- Refinement: selected parents retain original R160 values with a one-cell trilinear halo.
- Mass: every parent is represented either by its exact mean or all of its source values, so no tail or extinction mass is dropped.
- Access guard: selected trilinear sampling throws if any fine fetch reaches a cell outside the retained halo.
- Selection artifact: versioned `SBRK` header, explicit count, sorted uint32 parent indices, and SHA-256 identity.
- Hidden cap: none. Every frontier includes exact endpoints zero and full refinement.

## Exact Inputs

- Source route: `native-3d-compute-fluid-raymarch-v0`.
- Backend/source device: `WebGPU:apple`.
- R5 oracle report: `sha256:d6647887561039c1bc027da91d1c84bf5e634969bb02ebb36a33f969bdc1a50b`.
- R5 physical sidecar: `sha256:564efca0905957a8a44592309b7ce1618b14cfc486e658d92c6cd0f323b26b5a`.
- Extinction coefficient: `0.731`.
- Optical model: Beer-Lambert `1 - exp(-opticalDepth)`.
- Resolution: 320x228, one sample per R160 cell width.
- Display-only exposure: 8x; float artifacts and metrics remain linear.

Matched-optics report identities:

| Camera | SHA-256 |
| --- | --- |
| recorded native | `34cd9544b823289054558eae09247353772599fe21add665623ac8163cec9382` |
| elevated +35 | `3706f1d0c3b860b0945022bd6118e277cfc7bc72b2897854275e90f8dcf57a92` |
| side +90 | `cd5de8b525c360c1e40f381de4c4ce44a3a4e370282f9e9dc5110e5ed5cff95e` |
| back +180 | `5d60e441ebd16f70049284640a08c91f7b208bdae54ef80782586bbe7382aaf8` |

## Exact Commands

Native and elevated run both R80 and R40. Side and back repeat the complete R40 frontier after the two-view knee passed.

```sh
node smoke-adaptive-residual-brick-frontier.mjs \
  --matched-optics-report artifacts/pyro-smoke-matched-optics-r5-0716/native/matched-optics-report.json \
  --expected-report-sha256 sha256:34cd9544b823289054558eae09247353772599fe21add665623ac8163cec9382 \
  --out-dir artifacts/pyro-smoke-adaptive-residual-bricks-r6-0716/native \
  --block-sizes 2,4 \
  --energy-fractions 0,0.25,0.5,0.75,0.9,0.95,0.98,0.99,1

node smoke-adaptive-residual-brick-frontier.mjs \
  --matched-optics-report artifacts/pyro-smoke-matched-optics-r5-0716/elevated-plus-35/matched-optics-report.json \
  --expected-report-sha256 sha256:3706f1d0c3b860b0945022bd6118e277cfc7bc72b2897854275e90f8dcf57a92 \
  --out-dir artifacts/pyro-smoke-adaptive-residual-bricks-r6-0716/elevated-plus-35 \
  --block-sizes 2,4 \
  --energy-fractions 0,0.25,0.5,0.75,0.9,0.95,0.98,0.99,1

node smoke-adaptive-residual-brick-frontier.mjs \
  --matched-optics-report artifacts/pyro-smoke-matched-optics-r5-0716/side-plus-90/matched-optics-report.json \
  --expected-report-sha256 sha256:cd5de8b525c360c1e40f381de4c4ce44a3a4e370282f9e9dc5110e5ed5cff95e \
  --out-dir artifacts/pyro-smoke-adaptive-residual-bricks-r6-0716/side-plus-90 \
  --block-sizes 4 \
  --energy-fractions 0,0.25,0.5,0.75,0.9,0.95,0.98,0.99,1

node smoke-adaptive-residual-brick-frontier.mjs \
  --matched-optics-report artifacts/pyro-smoke-matched-optics-r5-0716/back-plus-180/matched-optics-report.json \
  --expected-report-sha256 sha256:5d60e441ebd16f70049284640a08c91f7b208bdae54ef80782586bbe7382aaf8 \
  --out-dir artifacts/pyro-smoke-adaptive-residual-bricks-r6-0716/back-plus-180 \
  --block-sizes 4 \
  --energy-fractions 0,0.25,0.5,0.75,0.9,0.95,0.98,0.99,1
```

## Four-Camera Knee

All rows below use the same R40 selection. Storage and retained-fine ratios are camera-independent.

| Residual energy | Bricks | Fine cells with halo | Storage | Worst luma nMSE | Worst peak error | Charged samples |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 90% | 259 | 0.63% | 3.75% | `6.73e-4` | 8.32% | 33.79-35.89% |
| 95% | 394 | 0.89% | 4.01% | `3.22e-4` | 3.91% | 33.97-36.04% |
| 98% | 614 | 1.36% | 4.48% | `1.27e-4` | 2.73% | 34.28-36.30% |
| 99% | 789 | 1.67% | 4.80% | `6.87e-5` | 2.46% | 34.52-36.51% |

The 98% selection identity is `sha256:4bbc3105534b61a92e41e45fa2b2d52f3178a191cba95424dfb41df74ceaf8ec` on all four cameras. The 99% identity is `sha256:594b2e11199dd26ddf3f0bbeea58f31cce41a9d14160b43971dcb5299781e6f3` on all four cameras.

## Visual Inspection

Context HTML: `contextual-comparison.html`, `sha256:013de2b92eb7015aebf9aa55cdce97a699dfec77c96174707858be672d5db3dd`.

Inspected four-camera record: `contextual-comparison.png`, `sha256:307f8df14cab7bffc88eb0f45a469ac94830202de15057b852226b9a3ea7578b`.

Every row names its camera and visible reference feature. Every panel names its role, selected count, storage, modeled charged samples, linear nMSE, and peak-local error. Coarse-only visibly introduces horizontal banding or cavity/layer collapse. The 90% arm restores the primary tongue/fold topology but leaves visible local error on the side view. The 98% and 99% arms are visually close to dense at the shared 8x exposure on native, elevated, side, and back.

## Report Identities

| Camera | Frontier report SHA-256 |
| --- | --- |
| recorded native | `31e9ef1bc7c5c10f09384d922366c8de0a756a0dc9e5379d153d24cac3adb571` |
| elevated +35 | `7abd31fc852bafdef7aeec09eb514e4b0f7906fb17c554ca3c4cd41c759278f8` |
| side +90 | `1dfb2c460efbea370a7b78cefaa4f07d8fc2afec62498f6da1dd70272b557bd2` |
| back +180 | `0c161b4e447255d0173ee888d79b45d9a2512a31fc6380ebb2e04a282899ef98` |

## Failure And Verification Notes

- The first R160 full-refinement run failed durably at selection because a variadic append overflowed the JavaScript argument stack at 512,000 bricks. A 262,144-brick fail-first scale contract now binds the repaired iterative path.
- A zero-selection binary artifact initially had zero bytes and was rejected as partial evidence. The selection format now has a fixed `SBRK` header and explicit count, including the zero endpoint.
- Wrong matched-report SHA and missing/partial endpoint requests produce durable failed reports naming the failure phase.
- The test fixture includes a diffuse nonzero tail; zero residual refinement must conserve it through coarse parent means.
- Full refinement must reconstruct every source cell and optical-depth pixel exactly.
- Fine sampling is access-guarded against cells outside the retained halo.

## Claim Boundary And Next Gate

This is static, one-source-state, four-camera, isolated pre-absorption extinction evidence. The CPU implementation reads the dense source to construct and verify the candidate; candidate storage accounting includes only the coarse field and access-guarded retained fine halos. Charged samples and texture fetches model a hierarchy traversal that collapses contiguous unrefined parent runs. They are not GPU timestamps, wall-clock speedup, production memory behavior, compositor cost, or update cost.

The result justifies one isolated WebGPU prototype of dense R160 versus R40 + the persisted 98% selection. That prototype must prove effective Apple WebGPU identity, use timestamp queries or another validated GPU timing source, charge hierarchy lookup and residual fetch, and compare rendered output. Only a measured pass-level speedup after all overhead earns temporal steps 45/46/47 or live integration work.
