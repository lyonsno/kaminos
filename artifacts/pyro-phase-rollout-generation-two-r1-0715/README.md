# H12 Rollout Generation Two

Question: Does a second frozen-seed H12 scheduled-exposure generation extend the recurrent fire horizon, or has first-generation H12 reached its fixed point?

Result: **generation two is a small, consistent extension**. It improves state error and exact-energy retention over generation one in every aggregate and final-quarter Q1/Q2/Q3/Q4/transport/birth comparison under exactly identical support. The visual delta is real but subtle: slightly more violet interior and orange-rim energy survive through the middle and terminal sequence, while the exact tall orange flame sheet remains substantially unrecovered.

## Visual Context

`beauty-gen1-vs-gen2.png` and `debug-gen1-vs-gen2.png` are chronological comparisons from one held-out protected-support rollout:

- Rows: step 1 / `0.16 s`, step 32 / `5.12 s`, step 63 / `10.08 s`.
- Column 1: exact held-out reference state.
- Column 2: copied-current control state.
- Column 3: first-generation H12 prediction.
- Column 4: second-generation H12 prediction.
- The two prediction tiles retain their source `PREDICTED` labels; the guide places explicit generation labels immediately above the image.
- Debug uses the same states, camera, support, and cadence with an additive display-only cohort mix at requested/effective gain `0.625`. It does not mutate model state.

Inspected visual read: generation two is modestly brighter and more saturated than generation one at `5.12 s` and `10.08 s`, with no new support artifact or phase-swimming failure. At the terminal frame both predictions recover a faint left vertical plume absent from copied control, but it remains cool and much weaker than the exact orange plume. Neither generation restores the exact tall flame-sheet topology.

## Moving Witnesses

- `gen1-comparison.mp4` and `gen2-comparison.mp4`: matched finite beauty witnesses; left exact reference, middle copied control, right prediction.
- `gen1-debug-comparison.mp4` and `gen2-debug-comparison.mp4`: the same role states with additive display-only cohort gain `0.625`.
- Every video is `960x240`, `63` frames, `6.25 fps`, `10.08 s`, and non-looping.

## Cohort Result

State ratios are prediction MSE divided by copied-control MSE; lower is better and values below `1` beat identity reuse.

| Cohort | Gen1 aggregate | Gen2 aggregate | Gen1 steps 49-63 | Gen2 steps 49-63 |
| --- | ---: | ---: | ---: | ---: |
| Q1 | `0.9044` | **`0.8639`** | `0.9438` | **`0.8866`** |
| Q2 | `0.9013` | **`0.8862`** | `0.9316` | **`0.9074`** |
| Q3 | `0.8935` | **`0.8848`** | `0.9362` | **`0.9203`** |
| Q4 | `0.9354` | **`0.9323`** | `0.9948` | **`0.9872`** |
| Transport | `0.9459` | **`0.9384`** | `1.0275` | **`1.0143`** |
| Birth | `0.9717` | **`0.9638`** | `1.0542` | **`1.0415`** |

Exact-energy retention rises in all twelve aggregate/final-quarter comparisons. Final-quarter Q1/Q2/Q3/Q4/transport/birth retention moves from `0.3669 / 0.2701 / 0.2406 / 0.2047 / 0.1896 / 0.1950` to `0.4392 / 0.2964 / 0.2566 / 0.2141 / 0.1975 / 0.2035`.

Generation two delays the birth cohort's persistent loss to identity from step `45` to step `58`, extending that measured horizon by `13` frames / `2.08 s`. It removes generation one's persistent Q4 loss at steps `61-63`. Transport still crosses persistently at step `58`, while its terminal ratio improves from `1.0638` to `1.0496`.

## Raster Result

The isolated offline splat raster agrees with the state metrics but shows the visual effect is small:

| View | Gen1 PSNR | Gen2 PSNR | Gain |
| --- | ---: | ---: | ---: |
| Beauty, all 63 frames | `14.2403 dB` | `14.3059 dB` | `+0.0655 dB` |
| Beauty, steps 49-63 | `14.3745 dB` | `14.4708 dB` | `+0.0963 dB` |
| Debug, all 63 frames | `13.1816 dB` | `13.2358 dB` | `+0.0542 dB` |
| Debug, steps 49-63 | `13.3211 dB` | `13.4018 dB` | `+0.0807 dB` |

## Route And Identity

- Training Greenroom job: `ebc74368cbbe`; recurrence job: `9cb0053d9569`; both completed exit `0`.
- Training route: MLX `Device(gpu, 0)`, null fallback, null timeout, frozen generation-one seed, horizon `12`, exposure `0.625`, candidate/splat/energy weights `0.1 / 1.0 / 0.25`.
- Recurrent exposure: `396,813 / 634,572` eligible inputs, no cap.
- Recurrence route: `protected-splat`, `63` steps, grid `160`, batch `4096`, MLX GPU, null fallback.
- Model SHA-256: `5eeb7e8563d59d59d7c8b69e4360634d7931db3399e993a36a27eb27f783f267`.
- Training report SHA-256: `23b8d46c6f97692a28f16a028b6d5f0e8964430dc869f69dd61faeec113029b4`.
- Predictions SHA-256: `fc19c101f3a1297ef42415117a4bf7e2e66e03c5a193bb7fa8fd569a8ac3746d`.
- Audit SHA-256: `17f48a901a44bfb3ea6ff4c6194c2cbe12f285892bb30f9bde5c6e439273177f`.
- Witness SHA-256: `7947119f6ce15250c894a4bb93ff0d95df53280439dc126f4e4ceb96a5964fb0`.
- Beauty/debug video SHA-256: `b0e186906f076d37731d38799f7e8fc3809c6b020a6f2ec55ef48d62c95a195c` / `af9ad1c0bc07899364da7ba51fb9878224f5471ff4e0453731036ff87831d2b3`.
- Training corpus SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1`.
- Evaluation corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`.

## Exact Commands

```sh
/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python -u boundary-splat-phase-state-residual-mlx.py --training-manifest /private/tmp/kaminos-phase-lag-crosswind-train-r1-0714/phase-corpus.json --evaluation-manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --out-dir /private/tmp/kaminos-phase-destination-state-rollout-h12-gen2-r1-0714 --hidden-size 128 --epochs 8 --batch-size 4096 --learning-rate 0.0005 --weight-decay 0.0001 --seed 713 --training-mode protected-rollout --rollout-seed-model /private/tmp/kaminos-phase-destination-state-rollout-h12-r1-0714/destination-state-model.json --rollout-horizon 12 --predicted-input-fraction 0.625 --candidate-loss-weight 0.1 --splat-loss-weight 1.0 --energy-loss-weight 0.25

/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python -u boundary-splat-phase-transport-mlx.py --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --model /private/tmp/kaminos-phase-transport-eulerian-full-r1-0714/transport-model.json --state-model /private/tmp/kaminos-phase-destination-state-rollout-h12-gen2-r1-0714/destination-state-model.json --state-recurrence-mode protected-splat --out-dir /private/tmp/kaminos-phase-transport-rollout-h12-gen2-protected-r1-0714 --inference-start 0 --inference-steps 63 --grid-size 160 --batch-size 4096

node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-transport-rollout-h12-gen2-protected-r1-0714/transport-predictions.json --out-dir /private/tmp/kaminos-motion-cohort-rollout-h12-gen2-r1-0714

node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-transport-rollout-h12-gen2-protected-r1-0714/transport-predictions.json --audit /private/tmp/kaminos-motion-cohort-rollout-h12-gen2-r1-0714/motion-cohort-audit.json --out-dir /private/tmp/kaminos-motion-cohort-rollout-h12-gen2-witness-r1-0714 --width 320 --height 240 --partial-flow-debug-gain 0.625
```

## Claim Boundary

One held-out live basin, frozen protected occupancy/support, isolated offline splat raster. Generation two truthfully extends the measured recurrent horizon and modestly improves visible late energy without copied-frame reuse. It does not restore the exact tall flame sheet, beat identity in final-quarter transported/birth state, establish analytical-raymarch agreement, prove multi-basin generalization or indefinite stability, authorize runtime integration, or constitute operator acceptance. Generation three is the fixed-seed iteration stop test; a stall or regression moves the next experiment to current-model online rollout or longer/multiple training episodes.
