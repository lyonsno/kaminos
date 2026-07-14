# Eulerian Destination Occupancy Phase Witness

Question: Does a motion-balanced local-grid occupancy model preserve phase-bearing flame support across candidate churn better than copied-current reuse and the prior static-scaffold model?

Result: Yes on support, not yet on complete fire evolution. The frozen model beats identity support IoU on all 63 transitions of a separate 10.08-second crosswind episode. Compared with the prior model, support and energy retention improve sharply in Q3/Q4, transported, and birth cohorts. The inspected movie keeps an orange upper sheet that the prior model deleted, but it does not reproduce the reference's rising plume or changing low-frequency envelope. Predicted support grows from 60,259 source candidates to 93,365 by 10.08 seconds while the exact target has 70,612, producing a broad blue/magenta lower-left accumulation.

## Inspect First

Open `inspection-guide.html` through the Kaminos server. It anchors every image and movie to the research question, role identity, cadence, sample time, and claim boundary.

`motion-cohort-comparison.mp4` is the primary static-attenuated beauty witness. `motion-cohort-debug-comparison.mp4` applies the required display-only `0.625` additive cohort mix to the same states and cadence. Both are `960x240`, 63 frames at 6.25 fps, 10.08 seconds, and non-looping.

Every movie frame is ordered left to right:

1. `REFERENCE`: exact held-out target state from the evaluation episode.
2. `CONTROL`: copied-current source state projected onto the current exact cohort map.
3. `PREDICTED`: recurrent output from the frozen learned model, projected onto the same cohort map.

The two contact sheets sample row-major at simulator times `0.16`, `0.48`, `1.12`, `2.08`, `4.16`, `6.24`, `8.16`, and `10.08` seconds. They summarize one temporal episode; they are not eight independent examples.

## Quantitative Result

The support model beats identity IoU at every recurrent step. The minimum ratio is `1.0335x`; the maximum is `1.2502x` at 480 ms.

| Step | Time | Prediction IoU | Identity IoU | Ratio |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 0.16 s | 0.4804 | 0.4348 | 1.1050x |
| 3 | 0.48 s | 0.2777 | 0.2221 | 1.2502x |
| 10 | 1.60 s | 0.1391 | 0.1164 | 1.1951x |
| 20 | 3.20 s | 0.1338 | 0.1177 | 1.1365x |
| 40 | 6.40 s | 0.1280 | 0.1144 | 1.1191x |
| 63 | 10.08 s | 0.1264 | 0.1223 | 1.0335x |

The model misses the audit's strict all-step motion gate only because copied-current wins Q3/Q4 on the first 160 ms transition. Prediction beats control on every populated motion-bearing cohort at 62 of the remaining 62 transitions.

| Cohort | Prior support recall | New support recall | Prior energy retention | New energy retention |
| --- | ---: | ---: | ---: | ---: |
| stable-q1 | 0.6026 | 0.5466 | 0.5061 | 0.4665 |
| stable-q2 | 0.3157 | 0.3659 | 0.2390 | 0.3249 |
| stable-q3 | 0.2115 | 0.3101 | 0.1619 | 0.2846 |
| stable-q4 | 0.1635 | 0.2891 | 0.1001 | 0.2394 |
| transported | 0.1234 | 0.1975 | 0.0894 | 0.1911 |
| birth | 0.1021 | 0.1519 | 0.0940 | 0.1892 |

At 160 ms, new Q4 support recall is `0.9588`, versus `0.545` for the prior model. The support-selection redirect worked. The remaining failure is recurrent state/envelope evolution plus compounding support-count inflation.

## Visual Inspection

The beauty and debug contact sheets, plus consecutive early and late encoded frames, were inspected at original resolution before this artifact was committed.

- Reference: the bright upper sheet changes contour continuously, sends tall plumes upward, and changes its large-scale envelope.
- Control: retains copied microstructure but dims rapidly under the exact moving-cohort projection.
- Prediction: preserves a coherent upper rim and more moving-cohort support than control after the first step. It shows real local variation rather than a copied frame.
- Failure: the predicted large-scale envelope changes too little, never follows the tall reference plume, and accumulates false blue/magenta support at lower left. Candidate count inflation is visible, not merely numerical.

The debug legend is green Q1/Q2, yellow Q3, red Q4, blue transported, magenta birth, and orange unmatched/death. The mix is display-only and does not mutate model or raster state.

## Route Receipt

- Worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch: `cc/pyro-phase-lag-counterfeiter-0713`
- Implementation head: `2b58fe441436195da63aaa79fdedde8737283f92`
- Objective: `motion-balanced-eulerian-destination-occupancy-v0`
- Candidate contract: exact 16 features; model input 64; four serialized layers
- Training: 13-frame independent crosswind episode, 160 ms cadence, hidden size 64, 8 epochs, batch 4096, learning rate 0.0015, weight decay 0.0001, seed 713
- Evaluation: separate 64-frame crosswind episode, 63 recurrent transitions, 160 ms cadence
- Backend/device: MLX `0.32.0`, `Device(gpu, 0)`, no fallback
- Training corpus SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1`
- Evaluation corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Model SHA-256: `e51c23d25eb38ec778c65774aae46c78bbcb02808d582539843417b10043c073`
- Predictions SHA-256: `48e79b733bd17864310f669b76ea0745e87eff2b17abbb6795b7be35ee13b1c8`
- Audit SHA-256: `e18c7f04acfb0e0b7e43c538ead1b3200b370b4de1ecee963e4f6a4014e55cc8`
- Beauty MP4 SHA-256: `932415410e02cbd499f2ca093d48188b8019dead40a20c8ae0d27f84ef2f39de`
- Debug MP4 SHA-256: `91419e20af1515841d59d260b821fa9684964ed22ff409fac9f87694f7c666e2`
- Beauty contact sheet SHA-256: `2e15e13968a5ccbdf7d1827d63248803c0aa9c0b9d41819a9de27001b2492e50`
- Debug contact sheet SHA-256: `d34fd4216751104bdd6a83c71a5035e03603f0edeaea2a825bcf7bc3b9f577f4`

Smoke route:

- Requested and effective URL: `http://127.0.0.1:18218/artifacts/pyro-phase-eulerian-destination-occupancy-r1-0714/inspection-guide.html`
- Mount: static path under the effective worktree server root; HTTP 200
- Route screenshot SHA-256: `57e1a8a9916d912594071f25f55226ce9f752a9d92a1dfbc58808278e14eefa3`
- Receipt: `smoke-receipt.json`

The `receipts/` directory preserves both corpus manifests, the frozen model, training and inference reports, and the effective Greenroom routes. The raw `.f32` payloads remain volatile and are not represented as durable bytes by this artifact; their recorded hashes are preserved in the manifests.

## Exact Commands

Training:

```bash
/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom submit \
  kaminos_phase_transport_motion_balanced_mlx_train \
  /private/tmp/kaminos-phase-lag-crosswind-train-r1-0714/phase-corpus.json \
  /private/tmp/kaminos-phase-transport-eulerian-full-r1-0714 \
  --cwd /private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713 \
  -p holdout_start=6 holdout_steps=3 grid_size=160 hidden_size=64 epochs=8 \
  batch_size=4096 learning_rate=0.0015 weight_decay=0.0001 seed=713 \
  objective_family=motion-balanced-eulerian-destination-occupancy-v0
```

Cross-episode inference:

```bash
/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom submit \
  kaminos_phase_transport_motion_balanced_mlx_infer \
  /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json \
  /private/tmp/kaminos-phase-transport-eulerian-crosswind-eval-r1-0714 \
  --cwd /private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713 \
  -p model=/private/tmp/kaminos-phase-transport-eulerian-full-r1-0714/transport-model.json \
  inference_start=0 inference_steps=63 grid_size=160 batch_size=4096
```

Motion audit and witness:

```bash
node boundary-splat-motion-cohort-audit.mjs \
  --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json \
  --predictions /private/tmp/kaminos-phase-transport-eulerian-crosswind-eval-r1-0714/transport-predictions.json \
  --out-dir /private/tmp/kaminos-motion-cohort-eulerian-crosswind-r1-0714 \
  --grid-step 0.0125

node boundary-splat-motion-cohort-audit.mjs \
  --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json \
  --predictions /private/tmp/kaminos-phase-transport-eulerian-crosswind-eval-r1-0714/transport-predictions.json \
  --audit /private/tmp/kaminos-motion-cohort-eulerian-crosswind-r1-0714/motion-cohort-audit.json \
  --out-dir /private/tmp/kaminos-motion-cohort-eulerian-witness-r1-0714 \
  --grid-step 0.0125 --width 320 --height 240 \
  --static-attenuation 0.1 --unmatched-attenuation 0.05 \
  --partial-flow-debug-gain 0.625
```

## Claim Boundary

This proves a cross-episode support advantage and a visible improvement over the prior static-selection failure under one controlled crosswind basin family and the isolated offline splat raster. It does not prove analytical-raymarch image agreement, a stable ten-second continuation, multi-basin generalization, or authorization to change live renderer/runtime composition. The next experiment should preserve this occupancy gain while learning motion-cohort state evolution and preventing recurrent count drift.
