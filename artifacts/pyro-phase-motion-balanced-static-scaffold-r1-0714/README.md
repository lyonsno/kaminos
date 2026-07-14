# Motion-Balanced Static-Scaffold Successor

Question: Does motion-cohort balancing plus an explicit copied static scaffold recover truthful phase motion, rather than merely retaining the support that changes least?

Result: It repairs the destructive support collapse, but it does not recover useful displacement. On the complete 63-transition crosswind holdout, prediction improves support and energy retention over copied-current control in every cohort in aggregate. Visually, however, it mostly performs local birth/death turnover inside the initial mound while the exact target grows, shears, and launches upper flame sheets. Mean frame-to-frame luma change is `2.618` for prediction, below copied-current control at `2.827` and far below exact reference at `10.218`.

This is valuable negative evidence against the current 28-way carrier-action decomposition. The next experiment should preserve the copied scaffold but predict Eulerian destination occupancy/birth-death residuals directly. It should not spend another slice tuning this carrier-direction classifier.

## Inspect First

Open `inspection-guide.html`. Both videos are `960x240`, `63` frames at `6.25 fps`, non-looping, and cover one finite `10.08` second simulator episode at a controlled `160 ms` cadence. Every frame burns in the same left-to-right roles:

1. `REFERENCE`: exact held-out target state for that transition.
2. `CONTROL`: copied current state projected onto the exact target cohort map.
3. `PREDICTED`: recurrent learned continuation projected onto that same exact cohort map.

`motion-cohort-comparison.mp4` is the primary beauty witness. Stable Q1/Q2 support is attenuated to `0.1`; motion-bearing Q3/Q4, transported support, and births remain full strength; unmatched/death support is retained at `0.05`.

`motion-cohort-debug-comparison.mp4` is the same sequence and roles with the required additive `0.625` display-only cohort mix: green Q1/Q2, yellow Q3, red Q4, blue transported, magenta birth, and orange unmatched/death.

The contact sheets sample the same episode approximately once per second. Read left-to-right within each triptych, then top-left to bottom-right through time. They are sequence summaries, not independent examples.

## Image-Anchored Inspection

`motion-cohort-contact-sheet-1s.png` is the beauty context. The exact reference changes its upper silhouette materially: folds migrate, the ridge rises and falls, and tall columns appear and disappear. Control and prediction retain a lower mound because static Q1/Q2 support is intentionally dimmed. Prediction is visibly fuller and less blue-starved than the prior frozen model, but it remains close to the control silhouette and does not reproduce the reference's rising sheets.

`motion-cohort-debug-contact-sheet-1s.png` is the cohort-support context. Prediction carries more Q3/Q4/transport/birth color than the prior model and slightly more than control in aggregate. That support remains distributed within the low mound. The debug view does not reveal a hidden transported sheet whose beauty appearance merely failed.

Both sheets were inspected at original resolution before packaging. The visible delta against the prior model is preservation of the basin-shaped scaffold and denser motion-bearing microstructure. The unresolved contract is coherent macroscopic phase travel.

## Temporal Activity

Frame-to-frame activity was measured directly on each role's 320x240 beauty frames using absolute luma differences over all 62 adjacent frame pairs.

| Role | Mean difference YAVG | Maximum difference YAVG |
| --- | ---: | ---: |
| exact reference | 10.218351 | 11.273400 |
| copied-current control | 2.826679 | 3.859750 |
| learned prediction | 2.617774 | 4.307940 |

The prior frozen model's prediction measured `1.348721` mean YAVG on the same episode and witness projection. The successor therefore roughly doubles retained visible activity relative to the failed predecessor, but it still moves less than current-state reuse. This is not product-shaped motion signal.

Exact measurement form, repeated once for each role:

```bash
ffmpeg -hide_banner -loglevel error -framerate 6.25 \
  -i /private/tmp/kaminos-motion-balanced-cohort-witness-r1-0714/beauty/predicted/frame-%03d.png \
  -vf "tblend=all_mode=difference,signalstats,metadata=print:file=-" \
  -f null -
```

## Cohort Result

| Cohort | Prediction support | Control support | Prediction energy | Control energy | Prediction beat-step fraction | Prediction/control state MSE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stable-q1 | 0.5985 | 0.5090 | 0.5092 | 0.4255 | 0.9841 | 1.1813 |
| stable-q2 | 0.3529 | 0.3041 | 0.2989 | 0.2686 | 0.9841 | 0.9932 |
| stable-q3 | 0.2704 | 0.2337 | 0.2414 | 0.2222 | 0.9841 | 0.9461 |
| stable-q4 | 0.2387 | 0.2116 | 0.1922 | 0.1858 | 0.9841 | 0.9418 |
| transported | 0.1733 | 0.1536 | 0.1620 | 0.1561 | 1.0000 | 0.9476 |
| birth | 0.1389 | 0.1234 | 0.1633 | 0.1561 | 0.9841 | 0.9621 |

The strict motion-cohort gate remains negative because Q3, Q4, and birth each fail to beat control on one of 63 transitions. The aggregate support result cannot close a motion claim.

Against the prior frozen model, support recall improves from `0.3157` to `0.3529` in Q2, `0.2115` to `0.2704` in Q3, `0.1635` to `0.2387` in Q4, `0.1234` to `0.1733` for transported targets, and `0.1021` to `0.1389` for births. The static-scaffold intervention did what it was designed to do: it stopped deleting most of the scene.

## Mechanism Audit

The model was trained over seven exact adjacent pairs with balanced-with-replacement carrier samples across Q1, Q2, Q3, Q4, transported, and death cohorts, plus balanced birth supervision. It retains the exact 64-input/16-candidate contract and existing four-layer deployed schema.

Training calibration exposes the remaining failure:

- Moving carrier-class accuracy/recall: `0.002867` (`701 / 244527`).
- Calibrated carrier action threshold: `0.00000745058`.
- Crosswind explicit transports: `90` total, present only in the first six of 63 steps (`43, 21, 11, 10, 4, 1`).
- Crosswind death actions: `34,189`.
- Crosswind selected births: `40,535`.
- Mean copied/static carriers per step: `70,686.6`.

The support advantage therefore comes from preserving the scaffold and replacing occupancy through birth/death selection, not from truthful carrier displacement. The 28-way action softmax has effectively abstained.

An initial one-epoch probe calibrated an invalid negative action margin and destroyed the scaffold. That anti-evidence is preserved in `receipts/probe-r1-training-report.json`. The validator and calibration were then tightened to a nonnegative action threshold before the full run; `receipts/probe-r2-training-report.json` preserves the corrected probe.

## Exact Commands

Full MLX training through GPU Greenroom job `0693c27c064b`:

```bash
/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python -u boundary-splat-phase-transport-mlx.py \
  --manifest /private/tmp/kaminos-phase-lag-tiger-world-key-r8-0713/phase-corpus.json \
  --out-dir /private/tmp/kaminos-phase-transport-motion-balanced-full-r1-0714 \
  --holdout-start 6 --holdout-steps 3 --grid-size 160 --hidden-size 64 \
  --epochs 8 --batch-size 4096 --learning-rate 0.0015 --weight-decay 0.0001 \
  --seed 713 --objective-family motion-balanced-static-scaffold-v0
```

Frozen crosswind inference through GPU Greenroom job `0c480716c4aa`:

```bash
/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python -u boundary-splat-phase-transport-mlx.py \
  --manifest artifacts/pyro-phase-transport-crosswind-motion-r1-0714/receipts/phase-corpus.json \
  --model /private/tmp/kaminos-phase-transport-motion-balanced-full-r1-0714/transport-model.json \
  --out-dir /private/tmp/kaminos-phase-transport-motion-balanced-crosswind-r1-0714 \
  --inference-start 0 --inference-steps 63 --grid-size 160 --batch-size 4096
```

Audit and witness:

```bash
node boundary-splat-motion-cohort-audit.mjs \
  --manifest artifacts/pyro-phase-transport-crosswind-motion-r1-0714/receipts/phase-corpus.json \
  --predictions /private/tmp/kaminos-phase-transport-motion-balanced-crosswind-r1-0714/transport-predictions.json \
  --out-dir /private/tmp/kaminos-motion-balanced-cohort-crosswind-r1-0714 \
  --grid-step 0.0125

node boundary-splat-motion-cohort-audit.mjs \
  --manifest artifacts/pyro-phase-transport-crosswind-motion-r1-0714/receipts/phase-corpus.json \
  --predictions /private/tmp/kaminos-phase-transport-motion-balanced-crosswind-r1-0714/transport-predictions.json \
  --audit /private/tmp/kaminos-motion-balanced-cohort-crosswind-r1-0714/motion-cohort-audit.json \
  --out-dir /private/tmp/kaminos-motion-balanced-cohort-witness-r1-0714 \
  --grid-step 0.0125 --width 320 --height 240 \
  --static-attenuation 0.1 --unmatched-attenuation 0.05 \
  --partial-flow-debug-gain 0.625
```

## Route Receipt

- Repository/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch: `cc/pyro-phase-lag-counterfeiter-0713`
- Implementation head: `5409ca6c306b4e4054e7a3e634e8aff3b640a425`
- Training route: MLX `Device(gpu, 0)`, runner `/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python`, null fallback, Greenroom job `0693c27c064b`
- Inference route: MLX `Device(gpu, 0)`, same runner, null fallback, Greenroom job `0c480716c4aa`
- Training corpus SHA-256: `51548442ececac255b3f94167e46428c39236d97ad767729d79d5ae51b0be534`
- Crosswind holdout corpus SHA-256: `672399fab2e404105a3b2ffff3563a3c491921a80edf11dbbd72082f09aa8850`
- Model SHA-256: `e42237bb1d081b52c786ac63319c2860c9fd41441490dbb86396d44577ee538f`
- Crosswind prediction manifest SHA-256: `0e71e0f782da3dbcfbc184a76263cb6daa8bc606fc5825266a05dc0253a38e17`
- Motion cohort audit SHA-256: `e875244a1338096fb5f3a1e8f8dede031c46f377111579550f5805aa752aa088`

The prediction manifest is durable here, but its 488 MB raw `.f32` state payload remains at the recorded `/private/tmp` paths and is not duplicated into Git. The model, corpus manifest, audit, videos, sheets, and full effective-route receipts are included.

## Visual Artifact Hashes

- Beauty MP4: `b80990ade8f1cf2f744cd74ed84489f5dc1780b8942a6ef4f85e8aac48292aa2`
- Debug MP4: `c2429f6e6135ae2d00282f2cac5adb300b96c76c7a2ededf5831a66d8141a5c9`
- Beauty contact sheet: `bb4f57be5393411709a1c7308f447308f90ce7f432dd6b0656874c7b9f815946`
- Debug contact sheet: `ebe08aa6fde344f4aec69e0e16777d5c69c1248292069300adb427400f8d81df`
- Witness report: `2d6306facdc296bca86d2011f9c03069be147a16f1d13e3f5b38847be2352f1b`

## Next Falsifier

Keep the copied Q1/Q2 scaffold and existing attribute head. Replace the 28-way carrier action with a local Eulerian destination-occupancy residual conditioned on the current 16-feature neighborhood. Train target-cell occupancy/birth/death directly with motion-cohort weighting, then require all three of these on the same crosswind witness:

1. Q3/Q4/transport/birth support and energy beat copied-current on every step.
2. Explicit predicted activity exceeds copied-current activity without deleting the scaffold.
3. The ten-second witness develops coherent traveling sheets or columns rather than stationary texture turnover.

If that capacity-adequate occupancy residual also remains below identity activity and cannot create traveling structure, the local-grid continuation family has reached the stop condition for this basin.

## Claim Boundary

This establishes the failure mechanism for one frozen model on one exact ten-second crosswind holdout under the isolated offline splat raster. It does not establish analytical-raymarch image error, does not prove the next Eulerian model will work, and does not authorize edits to the live renderer, instancing/runtime composition, or the steward's radiance trainer.
