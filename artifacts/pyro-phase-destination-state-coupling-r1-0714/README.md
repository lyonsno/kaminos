# Destination-State Signal And Coupled Recurrence Collapse

Question: Once Eulerian destination support and a local donor are fixed, can a learned head predict changing candidate/splat state better than carrying donor appearance, and does that advantage survive when the state head is coupled recurrently to the occupancy head?

Result: The first half is a strong yes; the coupled recurrence is a clear no. A separate 128-hidden MLX residual head beats carried-donor state MSE over all `3,059,367` motion-bearing destinations in a distinct 63-transition episode. Aggregate normalized MSE is `0.5796x` donor reuse, with every cohort winning. When those attributes feed back into occupancy, support advantage ends after step 17, Q3/Q4/transport/birth state error becomes worse than copied-current control, and the visible flame collapses from coherent early motion to a narrow red crown and near-extinction.

## Inspect First

Open `inspection-guide.html` through the Kaminos server. It anchors every visual to role, cadence, selected time, model route, and claim boundary.

`motion-cohort-comparison.mp4` is the primary non-looping 10.08-second witness. Every frame is left-to-right `REFERENCE` (exact held-out target), `CONTROL` (copied current projected onto the exact cohort map), and `PREDICTED` (combined frozen occupancy plus destination-state recurrence). `motion-cohort-debug-comparison.mp4` shows the same states with the required display-only `0.625` cohort mix.

The selected contact sheets are one ordered episode, not independent examples. Their row-major times are `0.16`, `0.48`, `1.60`, `2.72`, `2.88`, `3.20`, `6.40`, and `10.08` seconds. `inspection-consecutive-predicted.png` contains three row-major six-frame runs: `0.16-0.96`, `2.56-3.36`, and `9.28-10.08` seconds.

## Oracle-Support State Gate

The state head consumes the exact 64-value destination local-grid contract, 25 selected-donor attributes, and a 27-way donor displacement code. It predicts a 25-value residual over the exact 16 candidate features plus 9 non-position splat attributes. Training uses all 12 adjacent pairs from the independent 13-frame episode, balanced across Q3, Q4, transported, and birth; there is no sample cap or timeout.

| Cohort | Samples | Prediction / donor MSE |
| --- | ---: | ---: |
| Q3 | 478,652 | 0.7250x |
| Q4 | 478,617 | 0.3562x |
| Transported | 1,428,647 | 0.7445x |
| Birth | 673,451 | 0.7570x |
| Aggregate | 3,059,367 | 0.5796x |

This establishes learnable destination-state signal only after exact held-out support and donor assignment. It does not establish recurrent use on predicted support.

## Coupled Recurrent Result

All 128 predicted payloads are finite (`135,520,700` floats; maximum absolute value `14.3176`). State application preserves support and world position at each step. Residual magnitude is bounded rather than explosive: mean absolute residual is `0.0934` at step 1, `0.0267` at step 20, and `0.0446` at step 63.

The failure is feedback coupling. Updated candidate attributes become the next occupancy input, moving occupancy off its previously successful recurrent distribution. The occupancy-only model beat identity support IoU on all 63 steps; the coupled model beats it on only 17 and first loses at step 18. Predicted count still grows from `60,259` to `93,365` versus exact `70,612`, so count inflation remains.

| Cohort | Coupled support recall | Control support recall | Coupled / control state MSE | Coupled energy | Control energy |
| --- | ---: | ---: | ---: | ---: | ---: |
| Q3 | 0.2226 | 0.2426 | 2.2321x | 0.1196 | 0.2276 |
| Q4 | 0.1958 | 0.2151 | 1.3295x | 0.0956 | 0.1871 |
| Transported | 0.1267 | 0.1481 | 1.9579x | 0.0600 | 0.1481 |
| Birth | 0.0982 | 0.1159 | 2.0128x | 0.0537 | 0.1442 |

## Visual Inspection

- Early (`0.16-0.96 s`): the prediction has coherent changing microstructure and remains recognizably fire-like, but brightness and yellow energy decline monotonically while the upper sheet reddens.
- Break (`2.56-3.36 s`): the prediction converges to a repetitive narrow red crown over a dim blue body. The exact reference continues changing its sheet contour and emitting tall plumes.
- Late (`9.28-10.08 s`): almost all predicted flame energy is gone. Only disconnected red/orange fragments and a few low-energy blue points remain despite inflated support count.
- Debug: the fixed `0.625` additive view confirms that cohort support still exists; the beauty collapse is not a blank renderer or missing payload. State/energy and spatial registration have failed.

## Route Receipt

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch: `cc/pyro-phase-lag-counterfeiter-0713`
- Implementation parent: `6a2d2fe`; implementation and this artifact are committed together after verification
- Candidate contract: exact 16 features; occupancy model schema unchanged; auxiliary state artifact is separate
- Backend/device: MLX `0.32.0`, `Device(gpu, 0)`, no fallback
- Training corpus: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1`
- Evaluation corpus: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Occupancy model: `e51c23d25eb38ec778c65774aae46c78bbcb02808d582539843417b10043c073`
- State model: `46d7686dd59b192243e35f9e90c94082a1d100478d7e51b5460dc6c6a9eda5d4`
- Combined predictions: `ac4edaec92ad81ea14428f837638e6385ce0ba9b89e14b14b748ba0af7c882be`
- Combined audit: `2d10c3896028484aded9180df569e398c45ca9c0f293c5825d5a64e5c20d76f3`
- Beauty video: `4722d1753d39742852e3a61dab493b500dbb66f3626811a5de4f7367da1c4038`
- Debug video: `37983df6f07590f148e820597bb7d66062ad054be128048fd84b609348b11f94`

## Exact Commands

```bash
/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom submit \
  kaminos_phase_destination_state_residual_mlx_train \
  /private/tmp/kaminos-phase-lag-crosswind-train-r1-0714/phase-corpus.json \
  /private/tmp/kaminos-phase-destination-state-residual-r1-0714 \
  --cwd /private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713 \
  -p evaluation_manifest=/private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json \
  hidden_size=128 epochs=8 batch_size=4096 learning_rate=0.0015 weight_decay=0.0001 seed=713

/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom submit \
  kaminos_phase_transport_motion_balanced_mlx_infer \
  /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json \
  /private/tmp/kaminos-phase-transport-eulerian-state-crosswind-eval-r1-0714 \
  --cwd /private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713 \
  -p model=/private/tmp/kaminos-phase-transport-eulerian-full-r1-0714/transport-model.json \
  state_model=/private/tmp/kaminos-phase-destination-state-residual-r1-0714/destination-state-model.json \
  inference_start=0 inference_steps=63 grid_size=160 batch_size=4096

node boundary-splat-motion-cohort-audit.mjs \
  --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json \
  --predictions /private/tmp/kaminos-phase-transport-eulerian-state-crosswind-eval-r1-0714/transport-predictions.json \
  --out-dir /private/tmp/kaminos-motion-cohort-eulerian-state-crosswind-r1-0714

node boundary-splat-motion-cohort-audit.mjs \
  --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json \
  --predictions /private/tmp/kaminos-phase-transport-eulerian-state-crosswind-eval-r1-0714/transport-predictions.json \
  --audit /private/tmp/kaminos-motion-cohort-eulerian-state-crosswind-r1-0714/motion-cohort-audit.json \
  --out-dir /private/tmp/kaminos-motion-cohort-eulerian-state-witness-r1-0714 \
  --partial-flow-debug-gain 0.625 --width 320 --height 240
```

## Next Falsifier

Run dual-track recurrence. The occupancy head advances a canonical occupancy state using the frozen occupancy-only path that retained all-step support advantage. In parallel, the state head advances an appearance state on the same selected support, but its changed candidate attributes cannot feed back into occupancy. Compare one-step and recurrent appearance MSE and render the same witness. This tests whether the state head itself recurs coherently when support selection is protected, or whether its own appearance recurrence still collapses.

## Claim Boundary

This proves cross-episode one-step destination-state signal under exact support/donor assignment and proves that direct recurrent coupling to the current occupancy input is harmful in this basin. It does not prove a deployable continuation, analytical-raymarch image agreement, multi-basin generalization, or runtime integration. No live renderer, instancing, or steward-owned radiance trainer was edited.
