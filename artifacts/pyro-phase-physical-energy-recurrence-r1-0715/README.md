# Physical Visible-Energy Recurrence Falsifier

Question: Does correcting the destination-state loss from the historically misindexed channels to physical `opacity * Rec.709(color.rgb)` mitigate the late recurrent white-sheet collapse when model capacity, training/evaluation corpora, anchored online schedule, occupancy model, support composer, and support-envelope mechanism are held fixed?

Result: No. The corrected model is valid and changes payload values, but it leaves support selection exactly unchanged and produces the same visible collapse class. Under the training-episode support envelope, late decoded white area increases from `8.0043%` to `8.3837%` and late decoded RGB MSE to the exact reference increases from `3234.86` to `3268.30`. Corrected cohort energy retention rises slightly while most state-MSE ratios move by less than `0.1%`. The correction makes the same wrong recurrent topology slightly brighter; it is not a collapse mitigation.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch/head: `cc/pyro-phase-lag-counterfeiter-0713` at `7299a1b`
- Training Greenroom job: `c5f1e157d9d0`
- Legacy/unconstrained recurrence job: `d533c0d6039a`
- Training-envelope recurrence job: `f1a19c5759b9`
- Backend/device: MLX `Device(gpu, 0)` with null fallback for training and both recurrence routes
- Corrected checkpoint: `receipts/destination-state-model.json`, SHA-256 `48c7bb6ad4ce0fedbac6e4cecb92d3f5cbc619a9bc718775f87b49867fb38e65`
- Training/evaluation corpus SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1` / `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Witness: `63` exact heldout steps at `160 ms`, `6.25 fps`, `10.08 s`, `320x240` per role, no loop
- Frozen control: one pixel-identical source frame across all `63` frames

Witness command:

```sh
node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-physical-energy-support-legacy-r1-0715/transport-predictions.json --envelope-predictions /private/tmp/kaminos-phase-physical-energy-support-envelope-r1-0715/transport-predictions.json --legacy-training-report /private/tmp/kaminos-phase-physical-energy-support-legacy-r1-0715/training-report.json --envelope-training-report /private/tmp/kaminos-phase-physical-energy-support-envelope-r1-0715/training-report.json --legacy-receipt /Users/noahlyons/.local/state/gpu-greenroom/done/d533c0d6039a/receipt.json --envelope-receipt /Users/noahlyons/.local/state/gpu-greenroom/done/f1a19c5759b9/receipt.json --out-dir /private/tmp/kaminos-phase-physical-energy-witness-r1-0715 --width 320 --height 240
```

## Visual Context

Open `inspection-guide.html` first. Every visual appears beside its role and time-axis description.

- `recurrent-envelope-comparison.mp4`: corrected checkpoint, full-opacity beauty. Columns are exact `REFERENCE`, byte-identical frame-zero `FROZEN`, corrected-model unconstrained `LEGACY`, and corrected-model support-bounded `ENVELOPE`.
- `defective-recurrent-envelope-comparison.mp4`: exact matched predecessor using the historically defective visible-energy objective. It is the old-model comparator, not a static control.
- `recurrent-envelope-debug-comparison.mp4` and `defective-recurrent-envelope-debug-comparison.mp4`: same states/cadence with display-only cohort color at exact additive gain `0.625`.
- `images/corrected-five-time-contact.png`: corrected beauty rows from top to bottom are steps `1 / 16 / 32 / 48 / 63`, simulator times `0.16 / 2.56 / 5.12 / 7.68 / 10.08 s`; columns retain the four roles above.
- `images/defective-five-time-contact.png`: same rows/columns for the defective checkpoint.
- The two `*-debug-contact.png` files use the same role and time layout on the debug surface.

## Quantitative Read

Decoded grayscale luma greater than `235 / 255`:

| Model and role | Middle step 32 | Late mean steps 49-63 | Terminal step 63 |
| --- | ---: | ---: | ---: |
| Defective legacy | `10.1497%` | `13.3061%` | `14.3034%` |
| Corrected legacy | `10.5117%` | `13.7234%` | `14.7109%` |
| Defective envelope | `8.1068%` | `8.0043%` | `7.9688%` |
| Corrected envelope | `8.4505%` | `8.3837%` | `8.3542%` |

Terminal support is identical before and after correction: legacy `93,365` sites at IoU `0.1264323`; envelope `71,588` sites at IoU `0.1392223`; exact target `70,612`. The corrected envelope's aggregate state MSE is slightly better only for `stable-q1`; it is slightly worse for `stable-q2/q3/q4`, transported, and birth cohorts. All corrected cohort energy-retention values rise.

Full per-cohort aggregate/late comparisons and decoded metrics are in `receipts/old-vs-corrected-analysis.json` and `receipts/decoded-video-metrics.json`.

## Claim Boundary

This establishes on one exact heldout basin that correcting the physical visible-energy objective does not mitigate the long-horizon collapse under the matched anchored-online model and support composer. It does not prove the corrected loss is useless for one-step prediction, prove every capacity or rollout curriculum fails, establish analytical-raymarch error, authorize runtime integration, or generalize across basins. The strongest next pressure is recurrent support topology/identity, not another scalar support-count or visible-energy-weight tune.
