# Response-Anchored Online Rollout R1

> **Visual interpretation corrected:** operator inspection identified that the middle control moves. The underlying frame-zero payload is constant, but this artifact reapplies a changing exact-target cohort opacity mask every frame. Its cohort metrics remain diagnostic; it does not establish raw product-view advantage. The authoritative unmasked comparison is `../pyro-phase-unmasked-product-view-r1-0715/inspection-guide.html`, where the control is pixel-identical and both recurrent models lose to present-state reuse on every frame.

Question: can a frozen generation-two response anchor stop current-model online exposure from trading away late recurrent state fidelity while retaining its energy gain?

Result: yes, on this held-out 10.08-second basin. The response-anchored model improves generation two in every final-quarter state cohort, all six aggregate energy cohorts, all six final-quarter energy cohorts, and isolated-raster PSNR. Transport and birth still cross persistent identity loss at step 58, but neither crosses earlier. The prediction remains temporally distinct and visibly coherent through the final frame. It does not recover the exact target's tall flame sheet or full high-frequency energy.

## Inspect First

Open `inspection-guide.html`. It fixes all roles and sequence semantics next to the media:

- `REFERENCE`: exact held-out target state at each time.
- `CONTROL`: copied-current state projected onto that target's registered motion cohorts.
- `PREDICTED`: learned recurrent state with exact protected occupancy and donor alignment.
- Generation two is the frozen recurrent baseline.
- Response anchored is the new H12 online-exposure model with a generation-two teacher-response penalty on every predicted-input exposure row.

Both videos are finite 63-frame sequences at 6.25 fps, covering simulator steps 1-63 (`0.16-10.08 s`) without looping. Beauty attenuates Q1/Q2 to `0.1` and unmatched/death to `0.05`; debug adds the display-only cohort mix at gain `0.625`.

## What Changed

Against generation two, response anchoring changes full-episode beauty PSNR `14.305862 -> 14.374841 dB` and steps 49-63 `14.470845 -> 14.558301 dB`. Debug PSNR changes `13.235758 -> 13.273546 dB` overall and `13.401824 -> 13.445981 dB` late.

Late prediction/control state-MSE ratios improve in every cohort: Q1 `0.886588 -> 0.852241`, Q2 `0.907371 -> 0.897432`, Q3 `0.920295 -> 0.916316`, Q4 `0.987215 -> 0.983843`, transport `1.014349 -> 1.009037`, and birth `1.041520 -> 1.037722`. All late energy-retention values improve. The sole adverse comparison is aggregate birth state ratio, `0.963814 -> 0.964003` (`+0.000189`), while late birth improves and its persistent-loss step remains 58.

Visual inspection of start/middle/late frames and twelve evenly spaced predicted phases found temporally distinct violet-interior migration, changing orange boundary microstructure, and newly emerging bright patches. Compared with generation two, the anchor preserves modestly more moving interior energy. Compared with exact reference, both remain visibly attenuated and biased toward a lower-frequency, shorter flame sheet. This is mitigation, not full recovery.

## Route Receipt

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch/head at evidence creation: `cc/pyro-phase-lag-counterfeiter-0713` / `2fb0dd9c0e9ada27ed970ca1a34f4b87fe015bdf`
- Timestamp: `2026-07-15T06:55:02-04:00`
- Training Greenroom job: `08cdeaa22a1c`, exit 0, null timeout
- Recurrence Greenroom job: `9bc66e8f2967`, exit 0, null timeout
- Backend/device: MLX / `Device(gpu, 0)`; runner `/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python`; fallback null
- Training: seed 713, hidden 128, 8 epochs, 1,432 steps, H12, predicted-input fraction 0.625, response-anchor weight 1.0
- Exposure: 3,172,568 predicted rows and exactly 3,172,568 anchor rows; 5,076,576 eligible rows; no sample cap
- Anchor/seed model SHA-256: `5eeb7e8563d59d59d7c8b69e4360634d7931db3399e993a36a27eb27f783f267`
- Trained model SHA-256: `9216a4536e89e55bbc8c0cf408b96df25ef95f5ae4e7ad5629bda319bfe5dbbd`
- Held-out corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Recurrent predictions SHA-256: `0399ad81f1e0b33488136de228896d47dfb7287230afb077445e8ec294a89571`
- Cohort audit SHA-256: `6ebf920b03d9396c43ea5ce08d6590d573f828905cc0e7e45df9d0cebc4532b2`
- Witness SHA-256: see `SHA256SUMS`; receipt records exact per-frame role evidence and encode commands.

Exact train and recurrence commands are in `receipts/greenroom-*.json`. The audit and witness commands were:

```sh
node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-transport-anchored-online-h12-w1-protected-r1-0715/transport-predictions.json --out-dir /private/tmp/kaminos-motion-cohort-anchored-online-h12-w1-r1-0715
node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-transport-anchored-online-h12-w1-protected-r1-0715/transport-predictions.json --audit /private/tmp/kaminos-motion-cohort-anchored-online-h12-w1-r1-0715/motion-cohort-audit.json --out-dir /private/tmp/kaminos-motion-cohort-anchored-online-h12-w1-witness-r1-0715 --width 320 --height 240 --partial-flow-debug-gain 0.625
```

## Claim Boundary

This proves a response-anchor mitigation on one exact held-out basin under protected exact occupancy, fixed transport, isolated offline splat raster, and the deployed 16-feature candidate contract. It does not establish analytical-raymarch agreement, unsupported occupancy synthesis, multi-basin generalization, indefinite stability, live-renderer integration, or operator visual acceptance. Different isolated-raster appearance is not treated as analytical rendering error.
