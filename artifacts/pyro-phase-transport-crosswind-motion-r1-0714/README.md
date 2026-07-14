# Crosswind Long-Horizon Phase Transport Witness

Question: Does the frozen one-step local-grid occupancy/transport model preserve a temporally distinct, coherent flame state when recurrently continued for 4-10 seconds on an unseen live basin, or does it converge to a low-frequency attractor?

Result: It converges. The first recurrent steps contain plausible local motion and improve occupancy IoU over current-state reuse, but the predicted flame-sheet envelope visibly drains within about one second. By the later witness the prediction is a broad blue-gray horizontal band with residual flicker, while the exact held-out reference retains a bright, folded, moving upper interface. The prediction beats identity occupancy IoU through step 13 (`2.08 s`) and first loses at step 14 (`2.24 s`), but the visual flame-sheet failure begins earlier. This exact frozen one-step recurrent model is not a viable 4-10 second continuation model.

## Inspect First

Open `inspection-guide.html`. Both videos are `960x240`, `12 fps`, `127` frames, and `10.583333 s` encoded playback representing `10.08 s` of simulator time. Each video is arranged left-to-right as:

1. `REFERENCE`: exact held-out target states from the fresh live simulator corpus.
2. `CONTROL`: the initial/current state held fixed for every frame.
3. `PREDICTED`: recurrent output from the frozen learned model.

`beauty-comparison.mp4` is the primary appearance witness. `partial-flow-debug-comparison.mp4` uses the required `0.625` additive flow-debug mix and preserves the same reference/control/predicted roles. Neither video loops; a replay is an explicit viewer restart.

The contact sheets sample approximately once per encoded second, top-to-bottom. `beauty-contact-sheet-1s.png` exposes the color/luminance collapse. `debug-contact-sheet-1s.png` exposes loss of the folded upper interface and the stratified-haze attractor. The role labels are repeated in every row.

## Visual Inspection

The beauty witness was inspected at original resolution. Reference remains an orange-white flame sheet whose upper boundary rises, folds, and changes shape. Control is correctly motionless. Prediction loses the orange sheet almost immediately, descends into a low horizontal blue-gray band, and retains weak fine flicker after the coherent envelope is gone.

The additive flow-debug witness was also inspected at original resolution. Reference preserves a sharply folded moving upper interface; prediction flattens that interface while retaining noisy local activity underneath. This supports a low-frequency/envelope failure rather than total cessation of microstructure.

## Quantitative Boundary

- Occupancy IoU advantage over identity: steps `1-13`; first failure at step `14` (`2.24 s`). Prediction/identity IoU ratio is `1.1570` at step 1, `1.0234` at step 13, `0.9944` at step 14, `0.9311` at step 32, and `0.8040` at step 63.
- Predicted end/start luminance energy: `0.44856`; exact reference: `0.97228`.
- Predicted end/start spatial-detail energy: `0.50386`; exact reference: `1.05531`.
- Mean predicted low-frequency transition energy: `0.002794`; exact reference: `0.016621`.
- Mean predicted high-frequency transition energy: `0.002893`; exact reference: `0.011215`.
- Control transition energy is exactly zero, as expected.

Binary envelope area/width/height are threshold-saturated because faint predicted haze touches the full raster. Their near-one endpoint ratios are not evidence against the visible collapse and must not be used as closure metrics for this witness.

## Route Receipt

- Repository/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch: `cc/pyro-phase-lag-counterfeiter-0713`
- Witness code head: `b1514c5` (streamed renderer used for these pixels)
- Validation/authority repair head: `f6f82288737380d58fb621f5284bb3f4a8d12eed`
- Fresh basin: crosswind holdout, 64 exact states, `160 ms` cadence, one persistent browser, `10.08 s` simulator duration
- Corpus capture Greenroom job: `e9545fa00520`; effective native route and complete URL are in `receipts/corpus-greenroom-{request,receipt}.json`
- Frozen inference Greenroom job: `350e8abaafcd`; `203.748 s`, MLX `Device(gpu, 0)`, null fallback
- Effective inference route: `/private/tmp/kaminos-mlx-residual-venv/bin/python -u boundary-splat-phase-transport-mlx.py --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --model /private/tmp/kaminos-phase-transport-full-r2-0713/transport-model.json --out-dir /private/tmp/kaminos-phase-transport-crosswind-r1-0714 --inference-start 0 --inference-steps 63 --grid-size 160 --batch-size 4096`
- Offline witness command: `node boundary-splat-moving-phase-witness.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions /private/tmp/kaminos-phase-transport-crosswind-r1-0714/transport-predictions.json --out-dir /private/tmp/kaminos-phase-transport-crosswind-motion-r2-0714 --width 320 --height 240 --frames-per-step 2 --fps 12 --grid-step 0.0125 --partial-flow-debug-gain 0.625`
- Render route: offline deterministic splat projection from the exact held-out candidate states and recurrent predicted states; this is not the analytical raymarch reference.

## Identity And Hashes

- Inference corpus: `672399fab2e404105a3b2ffff3563a3c491921a80edf11dbbd72082f09aa8850`
- Model training corpus: `51548442ececac255b3f94167e46428c39236d97ad767729d79d5ae51b0be534`
- Model: `785ce32571aab2d5fe66b746f375bafcd57c85d5ab88442112fc3396b7af0747`
- Predictions: `10b7dbfd76643bec6847a790ea1a6e5c642f4c46923f6defb4e654948dd1f72e`
- Beauty MP4: `f66e5af3df671a5eb13a20798e1e9aeaef92895e003cfdd128ead6c5e8c76b3f`
- Partial-flow-debug MP4: `992002708e5ed8926d38a933986f643a9d824917680ad53ae59431c324e763e6`
- Beauty contact sheet: `31831635374ba5818919517e285f47b9e2eeeb7a43bbf43b75d2651b34def1ce`
- Flow-debug contact sheet: `ffa62195ab306c2f8e091ecb8e9f5572d31c65ae9699ccecbfd5ed0bc222de15`

## Provenance Caveat

The completed pixels were rendered by `b1514c5` while the later `f6f8228` authority repair was being developed. The prediction, model, and corpus hashes in `moving-phase-witness.json` bind those pixels to the genuine artifacts, but that pre-repair report does not contain the new `source.modelTrainingManifest` field. `posthoc-provenance-verification.json` records the explicit hash/equality checks and the repaired hostile-contract tests. It is a provenance verification, not an independent tensor-to-frame replay.

## Claim Boundary

This proves a terminal long-horizon envelope attractor for this frozen one-step model under recurrent reuse on one fresh crosswind basin. It does not prove that phase-conditioned prediction is generally impossible, that a multi-step/envelope-conditioned model will fail, or that different visual appearance alone is rendering error. The offline projection is appropriate for comparing motion roles and state evolution, but it is not an analytical raymarch of the splat reference.
