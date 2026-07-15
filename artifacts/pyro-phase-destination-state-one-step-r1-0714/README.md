# One-Step Destination-State Motion Witness

Question: Before recurrent prediction contaminates occupancy, does the frozen destination-state head visibly recover the next held-out state better than carrying its selected local donor unchanged?

Result: Yes, narrowly but consistently on this 64-frame crosswind episode. The learned role beats copied donor state in every trained motion cohort with aggregate normalized state-MSE ratio `0.5796416241561763`. Under the isolated offline splat raster, predicted-to-reference sequence PSNR is `28.605483 dB` versus control-to-reference `27.462430 dB` in beauty (`+1.143053 dB`) and `29.446615 dB` versus `28.216482 dB` in the additive debug view (`+1.230133 dB`). Direct inspection shows coherent prediction throughout all 63 independent adjacent evaluations, with subtle recovery of upper-sheet warmth, contour, and interior detail. This is positive one-step phase signal, not continuation.

## Roles And Time

- `REFERENCE`, left: exact held-out target restricted to sites with a valid local donor.
- `CONTROL`, middle: selected local donor carried unchanged onto the same exact target support.
- `PREDICTED`, right: one frozen learned destination-state residual on that same support.
- Every video frame is a separate adjacent `t -> t+160 ms` evaluation from the live episode. Frames are chronological, but model predictions are not fed into later frames.
- Unsupported births are excluded from all three roles. Cumulative eligible support is `4,016,659`; excluded unsupported births are `361,980`.
- Q1/Q2 static cohorts are attenuated to `0.1` in every role. The debug video applies a display-only cohort color mix at exact requested/effective gain `0.625`.

## Images And Video

- `destination-state-one-step-comparison.mp4`: 63-frame, 10.08-second beauty comparison at 6.25 fps; left/middle/right roles as above.
- `destination-state-one-step-debug-comparison.mp4`: the same payloads and cadence with display-only cohort colors.
- `beauty-early-middle-late.png`: nine chronological beauty samples. Top row is frames `0,1,2`; middle is `30,31,32`; bottom is `60,61,62`. Every tile contains reference/control/predicted from left to right.
- `debug-early-middle-late.png`: identical chronology and role layout under the `0.625` debug mix.
- `inspection-guide.html`: operator-facing contextual viewer for both videos and contact sheets.
- `inspection-guide-smoke.png`: inspected 1920x1400 browser capture proving the routed guide loads both labeled videos without overlap; this is route/UI evidence, not an independent research comparator.

## Route Receipt

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Feature branch: `cc/pyro-phase-lag-counterfeiter-0713`
- Evaluator and witness implementation: `089bcc6aebb0baf85ee000da675f5d97224c5127`
- Structurally exact role-order repair: `56dbc64` (artifact commit is the later commit containing this directory)
- Evaluation command: `/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python -u boundary-splat-phase-state-evaluate-mlx.py --model /private/tmp/kaminos-phase-destination-state-residual-r1-0714/destination-state-model.json --evaluation-manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --out-dir /private/tmp/kaminos-phase-destination-state-one-step-eval-r1-0714 --batch-size 4096`
- Witness command: `node boundary-splat-destination-state-witness.mjs --evaluation /private/tmp/kaminos-phase-destination-state-one-step-eval-r1-0714/destination-state-evaluation.json --out-dir /private/tmp/kaminos-destination-state-one-step-witness-r1-0714 --width 320 --height 240`
- Greenroom job: `705d85945dab`, completed with exit `0`, MLX `Device(gpu, 0)`, null fallback, null timeout.
- Frozen model SHA-256: `46d7686dd59b192243e35f9e90c94082a1d100478d7e51b5460dc6c6a9eda5d4`
- Evaluation corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Evaluation report SHA-256: `a1724c22038b30254802c68346dcb8cf32317d0836c9c90e59a45e3f639240f4`
- Requested/effective smoke route: `http://127.0.0.1:18218/artifacts/pyro-phase-destination-state-one-step-r1-0714/inspection-guide.html`, HTTP `200`, mounted from the owning worktree, inspected in one headless Chrome process.

## Claim Boundary

This establishes visible and numerical one-step advantage over copied donor reuse on one exact held-out basin under an isolated offline splat raster. It does not establish autoregressive stability, unsupported-birth synthesis, analytical-raymarch agreement, multi-basin generalization, runtime integration, or operator visual acceptance. Different appearance from an analytical reference is not treated as rendering error because no matched analytical raymarch is present.
