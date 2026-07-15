# Protected Online Rollout H12

Question: Does rebuilding H12 protected splat exposure from the current in-memory model before every epoch mitigate the late recurrent collapse that stopped improving under repeated frozen-seed generations?

Result: **no measured horizon extension on this run**. Online exposure creates a hotter recurrent prediction, but aligned state fidelity degrades earlier. Exact protected support is unchanged at all 63 steps. Aggregate and final-quarter visible-energy retention improve in every Q1/Q2/Q3/Q4/transport/birth cohort, while state-MSE ratio worsens in every cohort. Persistent state loss moves from step `58` to `53` for transport and from step `58` to `45` for birth; Q4 now loses persistently at step `61` and Q3 at step `63`.

This is useful directional evidence, not a null result: current-model exposure exerts a real pressure toward visible energy, but the current loss and training mixture let that pressure trade away phase-conditioned state accuracy.

## Visual Context

Every PNG and video is one matched heldout recurrence under the same frozen protected support, camera, cadence, raster, and semantic role layout.

- Inside every frame, left is the **exact heldout reference**, middle is the **copied-current control**, and right is the **recurrent prediction**.
- `generation-two-*` is the accepted frozen-seed H12 baseline, model `5eeb7e85...`.
- `online-*` is the epoch-refreshed current-model intervention, model `64098ba1...`.
- The three still times are `0.16 s`, `5.12 s`, and `9.92 s`; filenames name generation, view, and time directly.
- Debug images use the same states and cadence with an additive display-only cohort gain of `0.625`: green Q1/Q2, yellow Q3, red Q4/death, blue transport, magenta birth. Debug does not mutate model state.

Inspected read: the online prediction is visibly hotter and more violet/magenta at middle and terminal times. It does not restore the reference's tall orange sheet. Its terminal envelope diverges differently from generation two instead of merely becoming a brighter copy. The full motion witnesses remain necessary because three stills cannot establish smoothness, phase swimming, or terminal convergence by themselves.

## Moving Witnesses

- `generation-two-beauty.mp4` and `online-beauty.mp4`: matched finite beauty sequences.
- `generation-two-debug.mp4` and `online-debug.mp4`: the same role states with display-only gain `0.625`.
- Every video is `960x240`, `63` frames, `6.25 fps`, `10.08 s`, and non-looping.
- `inspection-guide.html` presents baseline and intervention side by side with visible role, generation, and time context.

## State Fidelity

Ratios are prediction mean state MSE divided by copied-control mean state MSE. Lower is better; below `1` beats current-state reuse.

| Cohort | Gen2 aggregate | Online aggregate | Gen2 steps 49-63 | Online steps 49-63 |
| --- | ---: | ---: | ---: | ---: |
| Q1 | `0.8639` | `0.8858` | `0.8866` | `0.9299` |
| Q2 | `0.8862` | `0.9050` | `0.9074` | `0.9455` |
| Q3 | `0.8848` | `0.9028` | `0.9203` | `0.9573` |
| Q4 | `0.9323` | `0.9405` | `0.9872` | `1.0079` |
| Transport | `0.9384` | `0.9509` | `1.0143` | `1.0391` |
| Birth | `0.9638` | `0.9792` | `1.0415` | `1.0678` |

First persistent loss steps, generation two -> online: Q3 `none -> 63`, Q4 `none -> 61`, transport `58 -> 53`, birth `58 -> 45`. Q1 and Q2 do not lose persistently in either run.

## Energy Tradeoff

Energy is predicted opacity-weighted Rec.709 visible energy divided by exact energy. Higher means more visible energy survives; it does not by itself imply lower state or analytical image error.

| Cohort | Gen2 aggregate | Online aggregate | Gen2 steps 49-63 | Online steps 49-63 |
| --- | ---: | ---: | ---: | ---: |
| Q1 | `0.4759` | `0.5092` | `0.4403` | `0.4857` |
| Q2 | `0.3217` | `0.3414` | `0.2965` | `0.3219` |
| Q3 | `0.2787` | `0.2955` | `0.2567` | `0.2776` |
| Q4 | `0.2356` | `0.2496` | `0.2146` | `0.2317` |
| Transport | `0.1882` | `0.2003` | `0.1976` | `0.2142` |
| Birth | `0.1858` | `0.1985` | `0.2035` | `0.2214` |

## Isolated Raster Read

Decoded-video PSNR also rises: beauty `16.2078 -> 16.3630 dB` overall and `16.2620 -> 16.4827 dB` over steps 49-63; debug `15.5516 -> 15.6517 dB` overall and `15.5853 -> 15.7327 dB` late. These values are a fresh, internally matched FFmpeg calculation over the decoded reference and predicted thirds of these two H.264 witnesses. They are not directly interchangeable with the prior PNG-space artifact values and do not establish analytical-raymarch agreement.

The disagreement is itself important: online exposure can look modestly closer under this isolated raster while becoming less accurate in aligned destination state and crossing the identity boundary earlier. Basin/render selection remains necessary before a visual difference is interpreted as renderer error.

## Training And Route

- Implementation: Kaminos `3a70e47`; fresh GPT-5.5/Codex review found no material findings.
- Training Greenroom: `652fdbd3feea`; recurrence Greenroom: `5b45f195d716`; both exit `0`.
- Effective backend/device: `mlx` / `Device(gpu, 0)`; fallback null; timeout null.
- Online model SHA-256: `64098ba1e5282b384d5c325a356e4a9446248762471fa3c59974007517c4bd8c`.
- Initialization model SHA-256: `5eeb7e8563d59d59d7c8b69e4360634d7931db3399e993a36a27eb27f783f267`.
- Training/evaluation corpus SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1` / `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`.
- Eight epoch refreshes at exact completed optimizer steps `0, 179, 358, 537, 716, 895, 1074, 1253`; epoch one is seed initialization and all later refreshes are post-update current model.
- Exposure: `3,172,568 / 5,076,576`, effective `0.6249424809`, sample cap null.
- Model/schema/capacity/loss: exact 116-input/25-output destination-state schema, hidden `128`, eight epochs, `1432` steps, candidate/splat/energy weights `0.1 / 1.0 / 0.25`.
- Protected recurrence: 63 steps, candidate state protected every step, occupancy feedback disabled, no support-count mismatches versus generation two.
- `SHA256SUMS` binds every preserved visual, receipt, metric, and guide file.

## Exact Commands

```sh
/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python -u boundary-splat-phase-state-residual-mlx.py --training-manifest /private/tmp/kaminos-phase-lag-crosswind-train-r1-0714/phase-corpus.json --evaluation-manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --out-dir /private/tmp/kaminos-phase-destination-state-online-rollout-h12-r1-0715 --hidden-size 128 --epochs 8 --batch-size 4096 --learning-rate 0.0005 --weight-decay 0.0001 --seed 713 --training-mode protected-online-rollout --rollout-seed-model /private/tmp/kaminos-phase-destination-state-rollout-h12-gen2-r1-0714/destination-state-model.json --rollout-horizon 12 --predicted-input-fraction 0.625 --candidate-loss-weight 0.1 --splat-loss-weight 1.0 --energy-loss-weight 0.25

/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python -u boundary-splat-phase-transport-mlx.py --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --model /private/tmp/kaminos-phase-transport-eulerian-full-r1-0714/transport-model.json --state-model /private/tmp/kaminos-phase-destination-state-online-rollout-h12-r1-0715/destination-state-model.json --state-recurrence-mode protected-splat --out-dir /private/tmp/kaminos-phase-transport-online-rollout-h12-protected-r1-0715 --inference-start 0 --inference-steps 63 --grid-size 160 --batch-size 4096

node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-transport-online-rollout-h12-protected-r1-0715/transport-predictions.json --out-dir /private/tmp/kaminos-motion-cohort-online-rollout-h12-r1-0715

node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-transport-online-rollout-h12-protected-r1-0715/transport-predictions.json --audit /private/tmp/kaminos-motion-cohort-online-rollout-h12-r1-0715/motion-cohort-audit.json --out-dir /private/tmp/kaminos-motion-cohort-online-rollout-h12-witness-r1-0715 --width 320 --height 240 --partial-flow-debug-gain 0.625
```

## Claim Boundary

One heldout live basin, exact oracle support/donor alignment, frozen protected occupancy route, and isolated offline splat raster. This run proves that epoch-refreshed current-model exposure raises visible energy but does not extend aligned state fidelity under the current loss/mix; it moves hard-cohort persistent loss earlier. It does not establish analytical-raymarch error, multi-basin generalization, unsupported-birth synthesis, indefinite stability, runtime uptake, or operator acceptance. It does not reject online exposure generally: a trust-region or dual-objective scheme that prevents state regression while retaining the energy gain remains untested.
