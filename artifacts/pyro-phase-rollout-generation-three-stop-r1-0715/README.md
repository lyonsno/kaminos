# H12 Rollout Generation Three Stop

Question: Does a third frozen-seed H12 scheduled-exposure generation continue the second generation's recurrent-horizon gain?

Result: **no**. Generation three reaches the predeclared stop boundary. It regresses generation two in every aggregate state cohort, every aggregate energy cohort, four of six final-quarter state cohorts, and every final-quarter energy cohort. Late transport and birth state improve by less than `0.04%`, while both lose energy and retain the same persistent identity-loss crossing at step `58`.

Repeated frozen-seed iteration is exhausted on this corpus/model. The next experiment must change the rollout distribution: current-model online rollout, longer training episodes, or multiple episodes. More frozen-seed generations and scalar energy-weight tuning are rejected directions.

## Controlled Comparison

- Same held-out basin and `63` adjacent transitions at `160 ms` cadence.
- Same frozen occupancy model, protected-splat recurrence, grid `160`, batch `4096`, and support trajectory.
- Same exact `116`-input / `25`-output destination-state schema, hidden size `128`, eight epochs, seed `713`, horizon `12`, exposure `0.625`, and candidate/splat/energy weights `0.1 / 1.0 / 0.25`.
- Generation two model `5eeb7e8563d59d59d7c8b69e4360634d7931db3399e993a36a27eb27f783f267` is the only changed training input.
- Generation-one, generation-two, and generation-three audits have zero support-count mismatches across every step, cohort, and role.

## State Result

Ratios are prediction MSE divided by copied-control MSE; lower is better.

| Cohort | Gen2 aggregate | Gen3 aggregate | Gen2 steps 49-63 | Gen3 steps 49-63 |
| --- | ---: | ---: | ---: | ---: |
| Q1 | **`0.8639`** | `0.8754` | **`0.8866`** | `0.9031` |
| Q2 | **`0.8862`** | `0.8895` | **`0.9074`** | `0.9120` |
| Q3 | **`0.8848`** | `0.8861` | **`0.9203`** | `0.9223` |
| Q4 | **`0.9323`** | `0.9335` | **`0.9872`** | `0.9888` |
| Transport | **`0.9384`** | `0.9386` | `1.01435` | **`1.01395`** |
| Birth | **`0.9638`** | `0.9639` | `1.04152` | **`1.04127`** |

Terminal transport/birth ratios improve slightly from `1.04958 / 1.06098` to `1.04755 / 1.05914`, but both generations cross persistently above identity at step `58`. Generation three does not extend the measured horizon.

One-step held-out aggregate ratio also regresses from generation two `0.6141467` to generation three `0.6149688`, while remaining better than generation one `0.6181570`.

## Energy Result

Generation three lowers exact-energy retention in all cohorts. Final-quarter Q1/Q2/Q3/Q4/transport/birth moves from generation two `0.4392 / 0.2964 / 0.2566 / 0.2141 / 0.1975 / 0.2035` to `0.3982 / 0.2822 / 0.2490 / 0.2105 / 0.1948 / 0.2007`.

The tiny late transport/birth state gains therefore do not represent a stronger visible-energy attractor. They are accompanied by broad state regression and unchanged crossing time.

## Route And Identity

- Accepted training job: `69c568771130`, exit `0`, MLX `Device(gpu, 0)`, null fallback, effective horizon `12`, exact generation-two seed.
- Accepted recurrence job: `432ea414d10a`, exit `0`, protected-splat, `63` steps, grid `160`, batch `4096`.
- Rejected training job: `34a12799f823`, execution exit `-15`; repeated CLI `-p` groups dropped the first parameter group and substituted default horizon `4`. Its output is not evidence.
- Model SHA-256: `a0a482e76e306bccc99dbb7e3045850aafc522f4a1c8a6653a25ac2ee87ee3a7`.
- Training report SHA-256: `a7ed37ec332e9ec06077708f9cddb7862c266e94320b4bdbfbea116df8e20471`.
- Predictions SHA-256: `c5294cd1bb6eb7be7046871984113b2516786d35780489aa0b7853a21eef2022`.
- Audit SHA-256: `40c79de2af86d39f7013043fb4a1071f1c8e4a1ada124ab03538a79e1ca70f98`.
- Accepted training/recurrence receipt SHA-256: `85161b0400d330fc582accfe53bbd76ae04cce03dd09aa09b8947100687c2345` / `8729bd0016ef135c2a30bddde6c40f1ca536951fbc0ca0864650a2c33749a592`.
- Rejected H4 receipt SHA-256: `91cd4c4876c7df41b20ac06844692a5bb5dd88dc63c88452d2e83dfe649113aa`.
- Training/evaluation corpus SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1` / `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`.

## Visual Boundary

No new generation-three moving witness was rendered. The model fails the numerical stop criterion before visual spend, and its tiny hard-cohort state changes are paired with broad regression and lower energy. The complete contextual generation-two witness at sibling artifact `pyro-phase-rollout-generation-two-r1-0715` remains the visual authority for the best frozen-seed model.

This is not evidence that generation three is visually catastrophic; it is evidence that another long matched render cannot answer a live decision. Any future visual witness should belong to the changed rollout algorithm or enlarged temporal corpus and retain the same exact/control/predicted roles, ten-second duration, and additive `0.625` debug view.

## Claim Boundary

One held-out live basin, one twelve-pair training episode, one fixed-capacity model, frozen protected occupancy/support, isolated offline state and splat-raster evidence. This stops repeated frozen-seed H12 iteration on the current corpus/model. It does not falsify current-model online rollout, longer or multiple training episodes, recurrent state/history architectures, analytical-raymarch agreement, multi-basin generalization, or runtime uptake.
