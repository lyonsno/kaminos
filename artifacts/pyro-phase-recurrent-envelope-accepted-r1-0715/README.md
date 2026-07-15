# Recurrent Training-Support Envelope, Accepted Pair R1

Question: does constraining recurrent candidate support to the frozen model training episode's frame-zero-relative count range mitigate the late white-sheet collapse without copying the present frame or hiding state behind a target-derived opacity mask?

Result: yes, materially but incompletely. The envelope starts clamping at step 25 and clamps 39 of 63 steps. Terminal candidate count changes from legacy `93,365` against exact `70,612` to envelope `71,588`; absolute count error falls from `22,753` to `976`. Terminal support IoU rises from `0.126432` to `0.139222`, and both learned routes beat identity support IoU at all 63 steps. In the inspected full-opacity witness, the envelope preserves substantially more of the orange upper flame-sheet silhouette and prevents the legacy route's broad upper-left saturated takeover. It still develops a bright low-frequency center and does not match the exact reference.

## Inspect First

- `recurrent-envelope-comparison.mp4`: the complete non-looping `10.08 s` beauty sequence. Fixed columns are exact held-out `REFERENCE`, byte-identical frame-zero `FROZEN`, unconstrained recurrent `LEGACY`, and training-envelope recurrent `ENVELOPE`.
- `images/start-middle-terminal.png`: the same four roles at steps `1 / 32 / 63`, simulator times `0.16 / 5.12 / 10.08 s`. This is a temporal contact, not alternate styling of one state.
- `images/nine-time-contact.png`: the same four roles at steps `1 / 8 / 16 / 24 / 32 / 40 / 48 / 56 / 63`, spanning the whole sequence. Use it to see when the legacy saturated diagonal grows and how much the envelope arrests it.
- `recurrent-envelope-debug-comparison.mp4`: the same states and cadence with additive display-only cohort color at exact gain `0.625`; it does not alter model state or beauty opacity.
- `images/start-middle-terminal-debug.png`: debug roles at steps `1 / 32 / 63`. Green marks low-change stable support, yellow/red higher-change stable support, blue transported support, magenta birth, and orange unmatched/death.

The moving-control failure from the earlier masked witness is absent here. Full-splat static and unmatched gains are both `1.0`, no exact-target cohort changes opacity, and all 63 frozen-control source PNGs have one SHA-256: `521047f5be6672a9ccc87141c86368b1f78c0e847d33f98ccc6bd1a1163f0a5b`.

## Visual Measurement

On the decoded final beauty video, pixels with grayscale luma greater than `235 / 255` occupy the following fractions:

| Role | Middle, step 32 | Late mean, steps 49-63 | Terminal, step 63 |
| --- | ---: | ---: | ---: |
| Reference | `2.6979%` | `2.5261%` | `3.3294%` |
| Frozen | `2.1849%` | `2.1849%` | `2.1849%` |
| Legacy | `10.1497%` | `13.3061%` | `14.3034%` |
| Envelope | `8.1068%` | `8.0043%` | `7.9687%` |

The envelope reduces late saturated-white area by `39.85%` relative to legacy. It remains more than three times the exact late fraction, so this is a causal mitigation result, not product closure.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch: `cc/pyro-phase-lag-counterfeiter-0713`
- Recurrence implementation and repaired receipt anchor: `462fe5bcc83a9a88c4093a8c53ede00eddaee0ec`
- Witness implementation/review repair/finalizer: `bfc87ea / 8093c6f / 1964ec3`
- Corpus: `/private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json`, SHA-256 `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Occupancy model SHA-256: `e51c23d25eb38ec778c65774aae46c78bbcb02808d582539843417b10043c073`
- Destination-state model SHA-256: `9216a4536e89e55bbc8c0cf408b96df25ef95f5ae4e7ad5629bda319bfe5dbbd`
- Frozen training manifest SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1`
- Inference frame zero: `frame-0`, `60,259` candidates
- Legacy Greenroom job: `8f5a5faf54be`, MLX `Device(gpu, 0)`, null fallback, `899.790670 s`
- Envelope Greenroom job: `9b445e295095`, MLX `Device(gpu, 0)`, null fallback, `592.887681 s`
- Final beauty video: SHA-256 `c3ac516c800ca526807e8d1e39ca716ee14772d4d3997fc43ddf16192432e80f`
- Final debug video: SHA-256 `e0e73f8bebd9f78341d3268d4ee4b5694acb937333184b47b1a7a67fe7d12b8b`
- Completed report: `receipts/recurrent-envelope-witness.json`, source SHA-256 `6546368df638aefa4196d957926cbef2c0afd74b2f2c7481bc5c8d7e9c4e331a`

```sh
node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-support-envelope-legacy-accepted-r1-0715/transport-predictions.json --envelope-predictions /private/tmp/kaminos-phase-support-envelope-recurrent-accepted-r1-0715/transport-predictions.json --legacy-training-report /private/tmp/kaminos-phase-support-envelope-legacy-accepted-r1-0715/training-report.json --envelope-training-report /private/tmp/kaminos-phase-support-envelope-recurrent-accepted-r1-0715/training-report.json --legacy-receipt /Users/noahlyons/.local/state/gpu-greenroom/done/8f5a5faf54be/receipt.json --envelope-receipt /Users/noahlyons/.local/state/gpu-greenroom/done/9b445e295095/receipt.json --out-dir /private/tmp/kaminos-phase-recurrent-envelope-witness-accepted-r1-0715 --width 320 --height 240
```

The first full run produced every audit, frame, and video but correctly wrote a failed final report at phase `report-write` because the writer's claim-boundary prose did not satisfy its validator. Commit `1964ec3` adds verified resume: it rehashes both audits, both nested witness reports, all 756 nested PNGs, and all nested videos before re-encoding and publishing the final report. The completed finalization command adds `--reuse-nested-artifacts` to the command above.

## Claim Boundary

This proves on one held-out live basin that recurrent support inflation is a major causal contributor to the late saturated sheet, and that a frozen training-episode count envelope materially improves support count, support IoU, visible saturation, runtime, and upper-sheet preservation. It does not remove the low-frequency state collapse, beat frozen present reuse in an analytical-raymarch comparison, prove cross-basin generalization, authorize runtime composition, or change the exact 16-feature candidate contract or deployed model schema.
