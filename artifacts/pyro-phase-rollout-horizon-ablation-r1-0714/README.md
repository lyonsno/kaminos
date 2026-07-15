# Protected Rollout Horizon Ablation

Question: Which single training pressure best extends the useful recurrent fire horizon: longer contiguous rollout exposure, more frequent predicted inputs, or stronger visible-energy loss?

Result: **contiguous rollout depth wins**. Extending the scheduled-exposure chain from four pairs to all twelve available training pairs improves aggregate and final-quarter state fidelity in every Q1/Q2/Q3/Q4/transport/birth cohort. Raising exposure probability from `0.625` to `0.875` helps, but loses to H12. Doubling visible-energy loss from `0.25` to `0.50` is effectively a null result and slightly worsens hard-cohort late state.

## Arms

- `H4`: successful first-generation baseline, horizon `4`, exposure `0.625`, energy weight `0.25`.
- `H12`: one continuous twelve-pair chain, exposure `0.625`, energy weight `0.25`.
- `E875`: horizon `4`, exposure `0.875`, energy weight `0.25`.
- `W050`: horizon `4`, exposure `0.625`, energy weight `0.50`.
- All arms retain the exact model schema, 116-input/25-output contract, hidden size `128`, eight epochs, seed `713`, frozen one-step rollout seed, canonical candidate/local-grid/donor/support state, and frozen occupancy trajectory.
- Prediction support counts are exactly identical across all four recurrent audits at every step and cohort.

## Hard-Cohort Result

State-MSE ratios are prediction versus copied-current control; lower is better and values below `1` win.

| Arm | Q4 aggregate | Transport aggregate | Birth aggregate | Q4 steps 49-63 | Transport steps 49-63 | Birth steps 49-63 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| H4 | `0.9573` | `0.9781` | `1.0041` | `1.0356` | `1.0793` | `1.1028` |
| H12 | **`0.9354`** | **`0.9459`** | **`0.9717`** | **`0.9948`** | **`1.0275`** | **`1.0542`** |
| E875 | `0.9417` | `0.9542` | `0.9802` | `1.0036` | `1.0400` | `1.0661` |
| W050 | `0.9581` | `0.9802` | `1.0060` | `1.0377` | `1.0834` | `1.1065` |

H12 also improves Q1/Q2/Q3 final-quarter ratios from `0.9799 / 0.9855 / 0.9922` to `0.9438 / 0.9316 / 0.9362`.

Energy does not explain the state win. H12 final-quarter Q4/transport/birth energy retention is `0.2047 / 0.1896 / 0.1950`, versus H4 `0.2018 / 0.1873 / 0.1930`. W050 is `0.2021 / 0.1871 / 0.1929`, proving that doubling the explicit energy coefficient alone does not lift retained energy on this model/corpus.

## Image Context

`beauty-h4-vs-h12.png` and `debug-h4-vs-h12.png` are one held-out rollout sampled chronologically:

- Rows: step 1 / `0.16 s`, step 32 / `5.12 s`, step 63 / `10.08 s`.
- Column 1: exact held-out reference.
- Column 2: copied-current control.
- Column 3: H4 predicted state.
- Column 4: H12 predicted state.
- The third and fourth source rasters both retain their original `PREDICTED` label; the artifact context distinguishes baseline and intervention.
- Debug is display-only cohort mixing at requested/effective gain `0.625`; it does not mutate state.

Visual read: H12 remains coherent and introduces no new visible failure, but the H4-to-H12 difference at the three sampled times is subtle. H12 does not recover the exact tall upper sheet or create a dramatic brightness change. The result is a measured late-state extension, not a large appearance leap.

## Moving Witnesses

- `h4-comparison.mp4` and `h12-comparison.mp4`: matched finite beauty witnesses, each left reference / middle control / right prediction.
- `h4-debug-comparison.mp4` and `h12-debug-comparison.mp4`: matched display-only `0.625` debug witnesses.
- All are `960x240`, `63` frames, `6.25 fps`, `10.08 s`, and non-looping.

## Route And Identity

- Training jobs: H12 `99c6ad7f0474`, E875 `48530d6be102`, W050 `99c70268ac78`.
- Recurrence jobs: H12 `c3497d4fee18`, E875 `d87b31046398`, W050 `d4442e82cbe1`.
- All six jobs completed exit `0` on the declared MLX route; model reports record `Device(gpu, 0)` and null fallback. Recurrence reports use the same MLX runner, frozen occupancy model, `protected-splat` mode, grid `160`, batch `4096`, and all `63` steps.
- H12 exposure: `396,813 / 634,572` eligible inputs, effective fraction `0.6253238403207201`, no cap.
- H12 one-step held-out ratio: `0.6181570475656539` versus H4 `0.6155535167703745`.
- Training corpus SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1`.
- Evaluation corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`.
- H12 model SHA-256: `68a7ef6abe1bb96a6250b664302075784e3ed62fdefc889be20552cb96254706`.
- H12 predictions SHA-256: `15f8a3e2051f0a030d0d4797df6a39d60a4bb92a5c5680147935bf905c05287b`.
- H12 audit SHA-256: `4890e29a7165a782b33f81cc32f242bb9a3516e95fb5dc80044c0fe39df22c5e`.
- H12 witness SHA-256: `ebf86ac114c11018f0dd02d76e7edf7882aec3bf7802019e993354097a3d3daa`.
- H12 beauty/debug video SHA-256: `3753400bde252b855d99d9121936e6a8cc9d2f6ee9d177c9ca56c274f2f5d515` / `c5fe799db1a309387c460527ec69e8b2f2980c81fb44717450458518dbe91eb9`.

## Claim Boundary

This isolates contiguous rollout depth as the strongest tested causal pressure for residual late-state drift on one held-out basin under the offline splat raster. It does not establish a large visible improvement over H4, analytical-raymarch agreement, multi-basin generalization, unsupported-birth synthesis, indefinite stability, runtime integration, or operator acceptance. The next falsifier is second-generation H12 training using the improved H12 model as the rollout seed; if that stalls, fixed offline self-rollout exposure is exhausted and the corpus or training algorithm must change.
