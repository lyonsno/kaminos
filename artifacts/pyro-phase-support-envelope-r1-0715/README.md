# Phase Support Envelope R1

Question: can a training-derived support-count envelope remove the recurrent white sheet by trimming already-generated predicted support with a deterministic, target-free state-local ranking?

Result: no. All three selectors improve the unmodified recurrence, proving support-count inflation contributes to the failure, but none removes the sheet or beats frozen present reuse. Physical-splat-support ranking gives the best late same-raster MSE (`4615.0416 -> 4088.2655`); protected-candidate-support ranking gives the best late white-pixel reduction (`10.0497% -> 8.0301%`). Frozen present remains much better at late MSE `1786.4463` and late white-pixel fraction `0.3216%`.

Evidence repair: fresh review found that the original in-frame bitmap font silently omitted unsupported letters. The complete 63-frame media and contacts were regenerated from the same source corpus, predictions, models, camera, cadence, and raster configuration after adding fail-loud glyph coverage. Stable receipt content, metrics, and selector accounting are unchanged; only label-dependent frame/control/video hashes, encoded bytes, and generated paths changed. The report validator now also rejects missing or malformed model identity, noncontiguous frame identity, and non-budget-exact selector accounting.

## Inspect First

Open `inspection-guide.html` and play the finite `10.08 s` video. The six fixed columns are:

1. `REFERENCE`: exact held-out full splat state.
2. `FROZEN`: pixel-identical frame-zero present state.
3. `PREDICTED`: unmodified response-anchor recurrent state.
4. `CANDIDATE SUPPORT`: predicted state trimmed to the envelope ceiling by protected candidate feature `sidecar.support`.
5. `PHYSICAL SUPPORT`: predicted state trimmed by physical splat support.
6. `VISIBLE ENERGY`: predicted state trimmed by physical `opacity * rec709(color.rgb)`.

Every panel uses full opacity and the same isolated raster. No exact target state participates in selection. This is post-composition diagnosis over already-generated states; recurrence was not regenerated.

## Images

- `images/start-six-role.png`: step 1; prediction count is below the ceiling and all selectors preserve the complete state.
- `images/middle-six-role.png`: step 32; trimming has begun, but the white diagonal remains in all selected roles.
- `images/terminal-six-role.png`: step 63; `21,777` of `93,365` predicted sites are removed, yet the dominant sheet persists.
- `images/start-middle-terminal-six-role.png`: the same three temporal anchors in row order.

## Count Contract

The separate 13-frame training episode contains `59,683-70,904` sites, a frame-zero-relative envelope of `1.0000x-1.18801x`. Applied to evaluation frame zero (`60,259`), the maximum budget is `71,588`, close to the held-out episode's actual range of `60,014-73,212`. The current recurrent composer instead compounds the one-step median ratio `1.0069738643` to `93,365` sites by step 63.

This witness filters each already-generated frame independently. It therefore cannot undo false support that entered earlier recurrence inputs. The partial improvement justifies one recurrence-level rerun in which the same training-derived envelope constrains composition before each next state is generated; it does not justify runtime uptake or a product claim.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch/base head at original generation: `cc/pyro-phase-lag-counterfeiter-0713` / `5fbc912`; label repair regenerated on the same branch under the reviewed artifact-repair commit
- Training corpus SHA-256: `f1ccbfa37eb90b065d461b54e814b7dd339a9d619b237143669a4371ff6d40b1`
- Evaluation corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Predictions SHA-256: `0399ad81f1e0b33488136de228896d47dfb7287230afb077445e8ec294a89571`
- Occupancy model SHA-256: `e51c23d25eb38ec778c65774aae46c78bbcb02808d582539843417b10043c073`
- Destination-state model SHA-256: `9216a4536e89e55bbc8c0cf408b96df25ef95f5ae4e7ad5629bda319bfe5dbbd`
- Inherited backend/device: MLX / `Device(gpu, 0)` / null fallback
- Raster: isolated CPU projected splat raster, `320x240` per role, full opacity
- Playback: 63 uncapped transitions, `160 ms`, `6.25 fps`, `10.08 s`, no loop

```sh
node boundary-splat-phase-support-envelope-witness.mjs \
  --training-manifest /private/tmp/kaminos-phase-lag-crosswind-train-r1-0714/phase-corpus.json \
  --evaluation-manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json \
  --predictions /private/tmp/kaminos-phase-transport-anchored-online-h12-w1-protected-r1-0715/transport-predictions.json \
  --out-dir /private/tmp/kaminos-phase-support-envelope-label-repair-r1-0715 \
  --width 320 --height 240 \
  --ffmpeg /opt/homebrew/bin/ffmpeg \
  --ffprobe /opt/homebrew/bin/ffprobe
```

`receipts/phase-support-envelope-witness.json` preserves every role/frame hash, selection score range and dropped count, source/model/backend identity, playback probe, and same-raster metric.

## Claim Boundary

This proves that support-count inflation contributes to the product-view collapse and that post-hoc count trimming is insufficient on this episode. It does not prove a recurrence-level envelope will succeed, analytical-raymarch agreement, multi-basin generalization, or runtime integration.
