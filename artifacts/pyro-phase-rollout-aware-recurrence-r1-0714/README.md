# Rollout-Aware Protected Recurrence Witness

Question: Does bounded predicted-state exposure across every deployed support cohort arrest the independent low-energy splat-appearance attractor without changing occupancy?

Result: Yes, materially, but not completely. Relative to the previous teacher-forced protected recurrence, the rollout-aware model changes no support decisions while reducing aggregate recurrent state error from a decisive loss to near parity or an advantage over copied-current control. It visibly preserves a coherent orange-violet flame body through the full `10.08 s` witness instead of draining into the prior dim cyan/blue basin. The remaining failure is narrower: the predicted fire under-produces the tall exact upper sheet, remains too compact, and begins losing state advantage on Q4, transported, and birth support in the final quarter.

## Image Context

`beauty-baseline-vs-rollout-aware.png` and `debug-baseline-vs-rollout-aware.png` are three-row chronological comparisons from one continuous held-out rollout:

- Top row: step 1, simulator time `0.16 s`.
- Middle row: step 32, simulator time `5.12 s`.
- Bottom row: step 63, simulator time `10.08 s`.
- Column 1: exact held-out `REFERENCE` target.
- Column 2: copied-current `CONTROL` projected onto exact motion cohorts.
- Column 3: old teacher-forced protected recurrence, labeled `PREDICTED` in-frame.
- Column 4: new rollout-aware protected recurrence, also labeled `PREDICTED` in-frame.

The column-3/column-4 distinction is therefore baseline versus intervention, not two simultaneous roles. The debug image adds the mandated display-only cohort color mix at requested/effective gain `0.625`; it does not mutate state.

## Moving Witnesses

- `baseline-protected-comparison.mp4`: old teacher-forced protected recurrence, left/reference, middle/control, right/baseline prediction.
- `rollout-aware-comparison.mp4`: new rollout-aware protected recurrence with the same three roles, basin, camera, support trajectory, `160 ms` cadence, and finite `63`-frame duration.
- `baseline-protected-debug-comparison.mp4` and `rollout-aware-debug-comparison.mp4`: corresponding additive `0.625` cohort-debug witnesses.
- Every video is `960x240`, `6.25 fps`, `63` frames, `10.08 s`, finite, and non-looping.

## Quantitative Result

All prediction support counts are exactly identical between the baseline and rollout-aware recurrence at every step and for every Q1/Q2/Q3/Q4/transport/birth cohort. The causal intervention is confined to splat appearance.

Aggregate recurrent state-MSE ratio versus copied-current control:

| Cohort | Baseline | Rollout-aware | Rollout-aware energy / exact | Control energy / exact |
| --- | ---: | ---: | ---: | ---: |
| Q1 | `2.1757` | `0.9260` | `0.4368` | `0.4282` |
| Q2 | `2.0310` | `0.9323` | `0.3069` | `0.2782` |
| Q3 | `1.8994` | `0.9250` | `0.2678` | `0.2276` |
| Q4 | `1.7548` | `0.9573` | `0.2259` | `0.1871` |
| Transported | `2.2684` | `0.9781` | `0.1803` | `0.1481` |
| Birth | `2.1330` | `1.0041` | `0.1770` | `0.1442` |

The final-quarter ratios are Q1 `0.9799`, Q2 `0.9855`, Q3 `0.9922`, Q4 `1.0356`, transported `1.0793`, and birth `1.1028`. Thus scheduled exposure removes catastrophic compounding but does not create an indefinitely stable attractor. The useful horizon is at least the first half; the final quarter shows smooth, bounded degradation rather than immediate collapse.

One-step held-out aggregate error remains positive but softens from baseline `0.5796x` to rollout-aware `0.6156x` carried-donor MSE. This is the intended trade: modestly less one-step optimization, vastly better recurrent behavior.

## Training And Route Identity

- Training Greenroom job: `954033b67bcc`, exit `0`, null timeout.
- Recurrence Greenroom job: `3c1e063a7283`, exit `0`, null timeout.
- Backend/device: MLX / `Device(gpu, 0)` for both model evaluation and recurrence; fallback reason null.
- Training mode: `protected-rollout`, four-pair horizon, requested exposure `0.625`.
- Exposure: `520,436` eligible inputs, `325,372` predicted-state inputs, effective fraction `0.6251911858518626`, sample cap null.
- Candidate state exposure and occupancy feedback: both false.
- Trained cohorts: Q1, Q2, Q3, Q4, transported, birth.
- Loss weights: candidate `0.1`, splat `1.0`, visible energy `0.25`.
- Evaluation corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`.
- Training corpus SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1`.
- Seed one-step model SHA-256: `46d7686dd59b192243e35f9e90c94082a1d100478d7e51b5460dc6c6a9eda5d4`.
- Rollout-aware model SHA-256: `ea7feacdc7b25ee4a32e8e7005128feca7a32adeb57bd9c870542d2547089013`.
- Frozen occupancy model SHA-256: `e51c23d25eb38ec778c65774aae46c78bbcb02808d582539843417b10043c073`.
- Prediction SHA-256: `2a7d1a14f2f3fb9c120342f9411825ecb398d54f315cf46ddc24226cc6d85aff`.
- Audit SHA-256: `efcf202f0cc5dde77a0dc418d3b039344c6321789e236f443e8a2132a94dc3c9`.
- Witness SHA-256: `56a9fcb59212babc3e9a677c54d9083d7200e9845ad99592c2fbf79410e2e6b0`.
- Beauty video SHA-256: `488cb89a99d9b3cbaa15b40193b24a564de141f4f0980e5696bb9bb7f1f8f91e`.
- Debug video SHA-256: `d5acb9254c28a700f574cfc3b5b11c8c22c4bc1b09b9fda6278b3c38f10b7267`.

## Visual Read

At `0.16 s`, baseline and rollout-aware predictions are nearly indistinguishable and both remain close to the exact reference. By `5.12 s`, the old recurrence has lost most of the upper orange sheet and collapsed toward cool interior residuals; the rollout-aware recurrence retains a continuous hot rim and a populated violet/orange body. At `10.08 s`, the old result remains a dim blue field with isolated hot points, while the rollout-aware result is still unmistakably a coherent fire body with active fine structure. The new result nevertheless remains shorter, dimmer, and less vertically energetic than exact reference.

## Claim Boundary

This is product-shaped mitigation on one held-out live basin under an isolated offline splat raster: a model trained with bounded recurrent exposure preserves temporally distinct, visibly coherent fire and beats or nearly matches copied-current state through a useful horizon without a copied-frame lie. It does not establish analytical-raymarch image agreement, multi-basin generalization, unsupported-birth synthesis, indefinite stability, runtime integration, or operator acceptance. No live renderer, runtime instancing composition, candidate contract, deployed model schema, or steward radiance trainer was changed.
