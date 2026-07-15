# Recurrent Exposure Phase Witness

Question: Does training the 64-wide Eulerian occupancy model on five frozen-seed recurrent support states, in addition to seven exact adjacent pairs, extend visible phase continuation or mitigate the late recurrent collapse?

Result: Recurrent exposure produces a small but persistent improvement over the frozen seed without curing the visible attractor. It improves held-out support IoU on 61/63 steps (`+2.479%` mean relative; best `+6.571%` at step 26) and label-excluded same-raster PSNR against the exact reference on 59/63 steps (`+0.219 dB` mean; best `+0.610 dB` at step 18). Direct inspection of the beauty and debug contact sheets shows that EXPOSURE redistributes some interior support/energy, especially in the early-middle horizon, but both learned roles still converge toward a bright low-frequency diagonal/interior saturation while REFERENCE continues changing flame-sheet topology. This is a measured mitigation, not a visual closure.

## Role Context

- `REFERENCE`: exact held-out simulator splat state at each future step. It changes truthfully with the live basin.
- `FROZEN`: frame-zero splat state repeated pixel-identically for all 63 frames. It is the present-state reuse control and must not move.
- `SEED`: the frozen exact-pair Eulerian occupancy model, recurrently reused under the accepted training-episode support envelope.
- `EXPOSURE`: a successor initialized from `SEED`, then trained on seven exact plus five frozen-seed recurrent pairs with no sample cap. It uses the same support-envelope policy and protected physical destination-state model as `SEED`.

## Inspect

- `inspection-guide.html`: contextual first surface. It defines roles, cadence, model identities, debug colors, metric result, and claim boundary adjacent to the moving media.
- `recurrent-exposure-comparison.mp4`: 10.08-second, 63-frame, non-looping raw-product view at 6.25 fps. Every splat keeps original opacity; no target-derived cohort mask is applied.
- `recurrent-exposure-debug-comparison.mp4`: the same four role states and cadence with an additive display-only flow-debug gain of exactly `0.625`. Green is stable Q1/Q2, yellow Q3, red Q4, blue transported, magenta birth, and orange unmatched/death.
- `beauty-contact-sheet.png`: steps 1, 8, 26, 48, and 63 from top to bottom. Each row is labeled `REFERENCE | FROZEN | SEED | EXPOSURE`.
- `debug-contact-sheet.png`: the same five temporal anchors and role order under the display-only flow debug.
- `receipts/recurrent-exposure-witness.json`: complete source, Greenroom, model, cadence, raster, video, and support-IoU identity.
- `receipts/pixel-comparison.json`: label-excluded PSNR comparison against the same exact reference raster.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch: `cc/pyro-phase-lag-counterfeiter-0713`
- Harness base commit: `9d057d0`
- Held-out corpus: `/private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json`, SHA-256 `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Training corpus: SHA-256 `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1`
- SEED model: SHA-256 `e51c23d25eb38ec778c65774aae46c78bbcb02808d582539843417b10043c073`
- EXPOSURE model: SHA-256 `88d5898448aed8ae1f92130e1a997f9ec6ef0301db0ac940ebf4794d36bc7645`
- Shared protected physical state model: SHA-256 `48c7bb6ad4ce0fedbac6e4cecb92d3f5cbc619a9bc718775f87b49867fb38e65`
- Effective inference backend: MLX `Device(gpu, 0)`, null fallback for both roles
- Greenroom jobs: SEED `f1a19c5759b9`; EXPOSURE `285dce2ffec4`
- Playback: 63 future states, 160 ms controlled simulator cadence, 10.08 simulated/encoded seconds, 6.25 fps, no generated loop
- Witness command: `node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-physical-energy-support-envelope-r1-0715/transport-predictions.json --exposure-predictions /private/tmp/kaminos-phase-rollout-exposure-support-envelope-r1-0715/transport-predictions.json --seed-training-report /private/tmp/kaminos-phase-physical-energy-support-envelope-r1-0715/training-report.json --exposure-training-report /private/tmp/kaminos-phase-rollout-exposure-support-envelope-r1-0715/training-report.json --seed-receipt /Users/noahlyons/.local/state/gpu-greenroom/done/f1a19c5759b9/receipt.json --exposure-receipt /Users/noahlyons/.local/state/gpu-greenroom/done/285dce2ffec4/receipt.json --out-dir /private/tmp/kaminos-phase-recurrent-exposure-witness-r1-0715`

## Artifact Hashes

- Beauty video: `06d455888ea6dc3380b6ad9becdfa778b61a9fcc1e44aadb6f1edb3a88c45455`
- Debug video: `4a5c5bb07162dd0be50e6d3b34c8c3b80d3262db81ce7760029d1cfea970c0ab`
- Beauty contact sheet: `d9d369054c0a5588eb8600d8ddf2dc58b8ad70aa9ac3751ef96e102d0cd1e570`
- Debug contact sheet: `63b52f5621024f174e670fcd18764b08c9f40c70d1b17dfe1e87ac2ca40f33fa`

Does not prove: analytical-raymarch image agreement, multiple-basin generalization, unsupported-birth recovery, indefinite stability, runtime composition fitness, or product acceptance. The isolated raster is useful for paired diagnosis but does not define all visually valid splat basins.
