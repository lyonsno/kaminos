# Phase Collapse Attribution R1

Question: does the response-anchor recurrence collapse toward a saturated white diagonal because its predicted visible splat channels drift, or because its recurrent support geometry/composition drifts?

Result: support composition is dominant in this held-out episode. Replacing predicted support with exact target support while retaining position-matched predicted color, opacity, and shape reduces late same-raster MSE from `4615.0416` to `79.9391` and late white-pixel fraction from `10.0497%` to `0.5878%`. Keeping predicted support while replacing exact color, opacity, shape, or all three reduces late MSE by only `15.49` to `66.59` and leaves the white sheet visibly intact. The terminal frame preserves the same separation.

## Inspect First

Open `inspection-guide.html` and play the finite `10.08 s` video. It contains nine fixed columns, left to right:

1. `REFERENCE`: exact held-out full splat state at each time.
2. `FROZEN`: one frame-zero present state, pixel-identical at all 63 times.
3. `PREDICTED`: unmodified response-anchor recurrent state.
4. `EXACT SUPPORT`: exact target support with position-matched predicted visible state.
5. `EXACT VISIBLE`: predicted support with position-matched exact color, opacity, and shape.
6. `EXACT COLOR`: predicted support with exact RGB on matched positions.
7. `EXACT OPACITY`: predicted support with exact opacity on matched positions.
8. `EXACT SHAPE`: predicted support with exact shape on matched positions.
9. `FROZEN VISIBLE`: predicted support with frozen color, opacity, and shape on retained frame-zero positions.

The exact substitutions are causal diagnostics, not deployable predictions. Every panel retains full splat opacity. No exact-target motion-cohort mask changes visibility.

## Images

- `images/start-nine-role.png`: all roles at step 1, before visible divergence.
- `images/middle-nine-role.png`: all roles at step 32; the white sheet appears in every predicted-support role and is absent from the exact-support role.
- `images/terminal-nine-role.png`: all roles at step 63; the support-conditioned separation persists at the end of the episode.
- `images/start-middle-terminal-nine-role.png`: the same three temporal anchors in row order for direct progression inspection.

## Mechanism

The occupancy model calibrates a median adjacent target/source count ratio of `1.0069738643` from seven training pairs. Recurrent composition reapplies that ratio to the current predicted count, so the budget compounds from `60,259` sites at frame zero to `93,365` at step 63. By steps 29-33, only `1-3` learned deaths activate per frame while quota births continue filling the growing budget. Exact target support at step 63 contains roughly `70,000` sites, so this is accumulated false support, not merely a differently colored valid sheet.

Source tracing also found a separate physical-index defect in the destination-state trainer. The physical row is `position.xyz, support, color.rgb, opacity, shape.xy, ridge, fireSignal`, but the trainer labels the nine non-position values as `scale.xyz, color.rgb, opacity, rotation.xy`. Its visible-energy loss therefore computes physical `shape.y * rec709(color.b, opacity, shape.x)` instead of physical `opacity * rec709(color.r, color.g, color.b)`. This defect should be corrected, but the substitutions show it is not the dominant cause of the current white-sheet collapse.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch/base head at generation: `cc/pyro-phase-lag-counterfeiter-0713` / `df5cbbf`
- Corpus: `/private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json`
- Corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Predictions: `/private/tmp/kaminos-phase-transport-anchored-online-h12-w1-protected-r1-0715/transport-predictions.json`
- Predictions SHA-256: `0399ad81f1e0b33488136de228896d47dfb7287230afb077445e8ec294a89571`
- Destination-state model SHA-256: `9216a4536e89e55bbc8c0cf408b96df25ef95f5ae4e7ad5629bda319bfe5dbbd`
- Backend/device inherited and revalidated from predictions: MLX / `Device(gpu, 0)` / null fallback
- Raster: isolated CPU projected splat raster, `320x240` per role, full opacity, kernel sharpness `6.5`
- Playback: 63 uncapped held-out transitions, `160 ms` cadence, `6.25 fps`, `10.08 s`, no loop

```sh
node boundary-splat-phase-collapse-attribution.mjs \
  --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json \
  --predictions /private/tmp/kaminos-phase-transport-anchored-online-h12-w1-protected-r1-0715/transport-predictions.json \
  --out-dir /private/tmp/kaminos-phase-collapse-attribution-r1-0715 \
  --width 320 --height 240 \
  --ffmpeg /opt/homebrew/bin/ffmpeg \
  --ffprobe /opt/homebrew/bin/ffprobe
```

`receipts/phase-collapse-attribution.json` records every frame hash, substitution match/fallback accounting, complete route identity, raster metrics, playback probe, and failure boundaries.

## Claim Boundary

This establishes support composition as the dominant cause of the saturated diagonal under one response-anchor recurrence, one held-out basin, and one isolated full-splat raster. It does not establish an analytical-raymarch error, a deployable support correction, multi-basin generalization, or runtime integration. The next honest falsifier is a zero-training support-budget intervention anchored to frame-zero or training-episode count envelopes, followed by the same unmasked 63-frame raster.
