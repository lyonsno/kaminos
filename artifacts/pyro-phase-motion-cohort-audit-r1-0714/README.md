# Motion-Cohort Phase Audit

Question: Did the frozen recurrent transport model learn the slowly changing support while discarding the support that carries visible phase motion?

Result: Yes. Across the complete 63-transition crosswind holdout, learned advantage is concentrated in the lowest-change stable cells and collapses in high-change same-cell, transported, and birth cohorts. The static-attenuated witness makes the support-selection failure visible: exact reference retains a bright moving upper sheet and rising columns, copied-current control retains a dim projection of some motion-bearing locations, and recurrent prediction rapidly loses the upper sheet and converges toward faint basal residue.

## Inspect First

Open `inspection-guide.html`. Both videos are `960x240`, `63` frames at `6.25 fps`, non-looping, and span `10.08` simulator and encoded seconds. Left-to-right roles are burned into every frame:

1. `REFERENCE`: exact held-out target state for the current transition.
2. `CONTROL`: the original current state, projected onto the current exact cohort map.
3. `PREDICTED`: the frozen model's recurrent state, projected onto the same exact cohort map.

`motion-cohort-comparison.mp4` is the primary beauty witness. `motion-cohort-debug-comparison.mp4` applies the required display-only `0.625` cohort/flow mix to the same role states and cadence. Neither video loops.

The contact sheets sample approximately once per encoded second, top-to-bottom. `motion-cohort-contact-sheet-1s.png` shows the motion-bearing beauty loss. `motion-cohort-debug-contact-sheet-1s.png` exposes cohort support. They are sequence summaries, not alternate models or independent temporal episodes.

## Cohort Definition

The exact stable-site-first one-cell correspondence is preserved. Same-position exact carriers are ranked independently within every adjacent transition by normalized change across all 16 candidate features and the 9 non-position splat channels. Source-frame spatial channel standard deviation supplies the fixed normalization.

- `stable-q1`: lowest exact state-change quartile.
- `stable-q2`: lower-middle exact state-change quartile.
- `stable-q3`: upper-middle exact state-change quartile; motion-bearing.
- `stable-q4`: highest exact state-change quartile; motion-bearing.
- `transported`: exact carrier displaced within one local-grid cell after stable sites are reserved.
- `birth`: exact target support with no assigned source carrier.
- `death`: exact source support with no assigned target carrier.

This distinction matters because Kaminos candidates occupy an Eulerian grid. A flame sheet can propagate through a stable world-position key as large material/radiance state change. The audit does not equate same key with static fire.

For the beauty witness, Q1/Q2 opacity is multiplied by `0.1`; Q3/Q4, transported support, and births remain at full opacity. Candidate support absent from the exact current target map, including visible death/false support, remains at `0.05` instead of being erased. Those values were registered before rendering and are not tuned from the witness.

The debug legend at additive gain `0.625` is green Q1/Q2, yellow Q3, red Q4, blue transported, magenta birth, and orange unmatched/death.

## Quantitative Result

| Cohort | Prediction support recall | Control support recall | Prediction energy retention | Control energy retention | Prediction beats control, fraction of steps |
| --- | ---: | ---: | ---: | ---: | ---: |
| stable-q1 | 0.6026 | 0.5090 | 0.5061 | 0.4255 | 0.9841 |
| stable-q2 | 0.3157 | 0.3041 | 0.2390 | 0.2686 | 0.8095 |
| stable-q3 | 0.2115 | 0.2337 | 0.1619 | 0.2222 | 0.1905 |
| stable-q4 | 0.1635 | 0.2116 | 0.1001 | 0.1858 | 0.1111 |
| transported | 0.1234 | 0.1536 | 0.0894 | 0.1561 | 0.0952 |
| birth | 0.1021 | 0.1234 | 0.0940 | 0.1561 | 0.1111 |

The monotonic energy-retention gradient is the decisive result. Learned prediction preserves about half of exact Q1 energy but only one tenth of Q4 energy and less than one tenth of transported/birth energy.

Among high-change sites that remain present, prediction state MSE is modestly better than copied-current (`0.876x` Q3, `0.893x` Q4, `0.919x` transported, `0.950x` birth). The primary failure is therefore support selection/retention, not total inability to estimate attributes on surviving movers.

At the first controlled step (`160 ms`), prediction already retains only `54.5%` of Q4 support and `49.6%` of its energy, while copied-current retains all Q4 support and `92.4%` of its energy. Prediction does create genuine non-copied transported and birth support at that step (`35.9%` and `25.4%` recall versus zero for control), but the advantage is not sustained under recurrence.

## Visual Inspection

Both contact sheets were inspected at original resolution.

- Reference: bright orange-white upper interface keeps folding and changing height; vertical flame columns appear and disappear over the episode.
- Control: substantially dimmer than reference under the exact moving cohort map, but retains a recognizable upper rim and more moving-cohort energy than prediction in later frames.
- Prediction: loses most upper-sheet support immediately, then converges toward sparse blue basal structure with weak scattered warm support.
- Debug: reference remains dense in Q3/Q4/transport/birth colors; prediction is systematically sparse in those colors. There is no hidden large moving sheet whose appearance alone was mis-rendered.

This visibly confirms the cohort metrics. The model learned a useful local state estimate for some surviving movers, but its recurrent support composer preferentially retains low-change cells and deletes phase-bearing support.

## Exact Commands

Quantitative audit:

```bash
node boundary-splat-motion-cohort-audit.mjs \
  --manifest artifacts/pyro-phase-transport-crosswind-motion-r1-0714/receipts/phase-corpus.json \
  --predictions artifacts/pyro-phase-transport-crosswind-motion-r1-0714/receipts/transport-predictions.json \
  --out-dir /private/tmp/kaminos-motion-cohort-crosswind-r1-0714 \
  --grid-step 0.0125
```

Static-attenuated witness:

```bash
node boundary-splat-motion-cohort-audit.mjs \
  --manifest artifacts/pyro-phase-transport-crosswind-motion-r1-0714/receipts/phase-corpus.json \
  --predictions artifacts/pyro-phase-transport-crosswind-motion-r1-0714/receipts/transport-predictions.json \
  --audit /private/tmp/kaminos-motion-cohort-crosswind-r1-0714/motion-cohort-audit.json \
  --out-dir /private/tmp/kaminos-motion-cohort-witness-r1-0714 \
  --grid-step 0.0125 --width 320 --height 240 \
  --static-attenuation 0.1 --unmatched-attenuation 0.05 \
  --partial-flow-debug-gain 0.625
```

## Route Receipt

- Repository/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch: `cc/pyro-phase-lag-counterfeiter-0713`
- Implementation head: `30e9d02` (`phase: audit motion-bearing support selection`)
- Corpus: 64 exact states at `160 ms`, native 3D compute-fluid raymarch, one persistent browser, null fallback
- Effective prediction route: MLX `Device(gpu, 0)`, null fallback
- Model SHA-256: `785ce32571aab2d5fe66b746f375bafcd57c85d5ab88442112fc3396b7af0747`
- Training corpus SHA-256: `51548442ececac255b3f94167e46428c39236d97ad767729d79d5ae51b0be534`
- Holdout corpus SHA-256: `672399fab2e404105a3b2ffff3563a3c491921a80edf11dbbd72082f09aa8850`
- Predictions SHA-256: `10b7dbfd76643bec6847a790ea1a6e5c642f4c46923f6defb4e654948dd1f72e`
- Audit SHA-256: `f15d36de23e20a1d8f4b84a3672a198f4138639c1fe04e04695d15eba59ff93b`

## Visual Artifact Hashes

- Beauty MP4: `ef3e7da5168560deed526edd51b82230835eef49aa40bc6abe1518496c873ebd`
- Debug MP4: `9e0ea1ecc3395284bf27c8bfe9c59a76c5b802a95a92d56d282ec8c0af0447c8`
- Beauty contact sheet: `fe05c098f6d000b280542bb84907ece9d6c3fe3314a4166846bdfbb22df2b9a2`
- Debug contact sheet: `cc717ac50646d7c7bff9b22c8ac282b44c2f507e03d7e4bf98010ae1080b1a2c`
- Witness report: `b7619fea4193b8f935adc438a949e2abcae34e26c690281ce0cfc3bad0b09c03`

## Training Redirect

Do not add a generic whole-fire envelope predictor yet. The measured next model should:

1. Preserve or cheaply reuse Q1/Q2 as an explicit static scaffold instead of spending learned capacity on persistence.
2. Balance carrier survival and displacement training over Q3/Q4/transported cohorts rather than the naturally dominant stable population.
3. Balance birth/death supervision and preserve their energy contribution, not only total candidate count.
4. Train/evaluate multi-step rollout with motion-cohort support and energy retention as load-bearing gates.
5. Retain the current attribute head initially; surviving high-change sites already show modest state-MSE advantage over copied-current.

## Claim Boundary

This proves static-support selection for this frozen model under one exact held-out recurrent crosswind episode and the isolated offline splat raster. It does not prove the proposed training remedy will work, does not establish analytical-raymarch image error, and does not authorize live renderer or runtime composition changes.
