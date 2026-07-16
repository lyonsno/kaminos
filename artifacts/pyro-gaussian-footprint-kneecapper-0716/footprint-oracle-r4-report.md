# Pyro Gaussian Footprint Kneecapper R4 Footprint Oracle Report

Research handle: `pyro-gaussian-footprint-kneecapper`

## Scope

This report records the first reproducible frozen-state footprint oracle slice for the Flamebowl Intrinsic target. It measures current-renderer footprint/attribute sufficiency against `candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0` while holding candidate positions, candidate payloads, target decomposition, and teacher raymarch identity fixed.

The r4 corpus is a three-frame same-browser sequence, not a same-state multi-camera corpus. Its disjoint evaluation frame is temporal/frame holdout evidence (`frame-002`), not held-out camera closure. Do not use this report to claim that one optimized 3D attribute set survives camera changes.

## Source Corpus

- Corpus: `artifacts/pyro-gaussian-footprint-kneecapper-0716/fresh-supervision-r4/corpus.json`
- Corpus identity: `sha256:06858b340d2a08973e2a5188c5dffb7c9f3b9b8ec5b1b9136e96d12cf763dbd6`
- Authority: `live-simulator-frozen-state-candidate-raymarch-v0`
- Target decomposition: `candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0`
- Teacher identity: requested ray steps `160`, effective ray steps `160`, render scale `1`
- Backend: `WebGPU:apple`
- Frames: `frame-000`, `frame-001`, `frame-002`
- Candidate count: `556448` total
- Sim steps: `257`, `260`, `263`

The first three failed capture attempts are preserved as reports under `fresh-supervision-r1/`, `fresh-supervision-r2/`, and `fresh-supervision-r3/`. The useful failure was a wrong-server/port collision: served `volume-core.js` lacked `captureBoundarySplatSupervisionFrame`. The witness now fails loud on that method surface instead of producing a misleading corpus.

## Footprint Path Mapped

- Base radius: `cellWidth * (0.60 + sidecar.footprint * 2.65 + sidecar.ridge * 0.48)`
- Learned radius: dimensionless `radiusScale.x/y`
- Global radius: dimensionless billboard scale in the raster vertex stage
- Sharpness: dimensionless Gaussian exponent multiplier in the fragment kernel
- Opacity: per-splat `colorOpacity.a` before Gaussian kernel and energy compensation
- Multiplication order: candidate base radius -> learned `radiusScale.x/y` -> global radius billboard scale
- Energy compensation: `sqrt((sharpness / 3.4) / max(globalRadius^2, 0.1225))`, clamped to `0.5..2.5`
- Absolute-radius substitution: rejected

## Completed Oracle Rows

### Best Global Calibration

- Report: `artifacts/pyro-gaussian-footprint-kneecapper-0716/r4-oracle-global/footprint-oracle-report.json`
- Family authority: `best-global-radius-sharpness-grid-v0`
- Sweep: radius `0.55,0.68,0.82` x sharpness `2.8,3.4,4.2`
- Best row: radius `0.55`, sharpness `4.2`
- Split: train `frame-000,frame-001`, evaluate `frame-002`
- Evaluation authority: `held-out-frame-mean-v0`
- Held-out loss: `0.1443721354007721`
- Best-global preview: `r4-oracle-global/runs/global-r0p55-s4p2/preview-trained-frame-002.png`

The global optimum sits at the smallest/sharpest tested corner and materially beats the default-looking `0.68/3.4` row, whose held-out loss is `0.22022897005081177`. Visual inspection showed the global row is still too bright and Beauty-like versus the Intrinsic target; it is directional evidence for tighter footprints, not closure.

### Least-Expressive Conditioned Family

- Report: `artifacts/pyro-gaussian-footprint-kneecapper-0716/r4-oracle-conditioned-bestglobal/footprint-oracle-report.json`
- Input corpus: best-global variant `r4-oracle-global/global-variants/corpus-r0p55-s4p2.json`
- Family authority: `least-expressive-conditioned-footprint-family-v0`
- Model authority: `shared-position-conditioned-feature-mlp-v0`
- Split: train `frame-000,frame-001`, evaluate `frame-002`
- Evaluation authority: `held-out-frame-mean-v0`
- Initial held-out loss: `0.1443721354007721`
- Trained held-out loss: `0.0021148694213479757`
- Initial held-out edge loss: `0.021106380969285965`
- Trained held-out edge loss: `0.008091580122709274`
- Trained preview: `r4-oracle-conditioned-bestglobal/runs/conditioned/preview-trained-frame-002.png`

Visual inspection showed the conditioned preview tracks the Intrinsic target's broad sheet mass, cavities, and vertical filament channels far better than the global row. This is strong evidence that a small view-independent attribute family over existing candidate features can explain the majority of the r4 temporal held-out residual relative to the best-global baseline.

## Pending Upper Bound

- Greenroom job: `372d90d7b3a2`
- Status at report time: `pending`
- Job type: `kaminos_splat_radiance_oracle_mlx_pyro_0716`
- Input: `r4-oracle-per-candidate-frame000/corpus-frame000.json`
- Output: `r4-oracle-per-candidate-frame000/greenroom-run`
- Params: `steps=160`, `render_width=320`, `depth_bins=1`, `edge_weight=0`, `expected_ray_steps=160`, `expected_render_scale=1`, `train_frame_indices=0`, `eval_frame_indices=0`
- Expected report authority after execution: `explicit-single-frame-per-candidate-table-oracle-v0` with `same-frame-per-candidate-table-oracle-v0`

This job is a same-frame per-candidate attribute-table upper bound only. It cannot close held-out camera or held-out frame generalization. It is useful for asking whether the current renderer can match one Intrinsic view when every candidate's RGB, opacity, and x/y radius are free.

The Greenroom status reported `volatile_output` because this worktree is under `/private/tmp`. The branch artifacts are still present in the worktree, but a final cross-session archival step should copy any completed Greenroom output to a non-volatile durable location if it becomes load-bearing.

## Decision Table Status

- Global calibration closes: no. It improves over defaults/manual-comparison baseline directionally, but visible residual remains large and Beauty-like.
- Conditioned view-independent family closes across held-out temporal frame: yes for this r4 temporal split, with held-out loss `0.0021148694213479757` from best-global `0.1443721354007721`.
- Training-view closes but held-out views fail: not tested yet. Same-state multi-camera corpus is still missing.
- No current footprint family closes training view: not established. Per-candidate single-frame oracle is queued as `372d90d7b3a2`.

## Current Verdict

The current candidate support is substantially more sufficient than default renders imply. The best evidence is the conditioned family: with candidate positions and Intrinsic target identity fixed, a small position-conditioned attribute head on the best-global footprint constants removes nearly all r4 temporal held-out residual relative to the best-global baseline.

This does not justify a full covariance promotion yet. The completed experiment is a coupled current-renderer attribute/footprint result, not isolated covariance, and it lacks same-state held-out camera proof. The next contract boundary is either a camera-holdout supervision corpus or Tiger-owned trainer routing for a focused view-independent conditioned head once camera evidence exists.

## Verification

- `node tests/boundary-splat-footprint-oracle-contracts.mjs`
- `node tests/boundary-splat-renderer-contracts.mjs`
- `node tests/boundary-splat-supervision-corpus-contracts.mjs`
- `node tests/boundary-splat-radiance-training-contracts.mjs`
- `node tests/boundary-splat-optical-decoder-contracts.mjs`
- `node tests/boundary-splat-supervision-witness-contracts.mjs`

All listed tests passed on 2026-07-16 in this worktree. Each Node run emitted the ambient warning that `NO_COLOR` is ignored because `FORCE_COLOR` is set.
