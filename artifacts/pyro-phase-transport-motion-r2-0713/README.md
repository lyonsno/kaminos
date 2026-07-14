# Local-Grid Phase Transport Motion Witness

## Research Question

Can one exact current learned-splat state produce several nearby, visibly moving fire phases without replaying a prerecorded clip? This witness tests a one-cell directional carrier model with explicit death and residual-birth heads. It is an isolated splat-state experiment; it does not edit the live renderer or runtime instancing path.

## How To Read The Motion

Open `inspection-guide.html` for the contextual record. Both videos are finite `+0 -> +3` held-out episodes with no loop metadata. Each video frame is a fixed triptych:

1. `REFERENCE`: exact held-out simulator states `frame-6`, `frame-7`, `frame-8`, and `frame-9`.
2. `CONTROL`: `frame-6` copied at zero velocity for the whole episode.
3. `PREDICTED`: recurrent learned local-grid transport plus residual churn.

`beauty-comparison.mp4` is the normal isolated splat raster. `partial-flow-debug-comparison.mp4` is the same sequence, camera, crop, and cadence with a display-only `0.625` mix: green is stable support, blue is transported support, magenta is birth, and orange is death. The videos contain 13 frames at 12 fps, interpolate four witness frames per controlled step, and end after 1.083 seconds. Player replay is an explicit viewer action, not a learned or authored loop.

The stills are diagnostic anchors, not independent unlabeled examples:

- `beauty-filmstrip.png`: 12 evenly sampled triptychs from the beauty video, arranged four timeline samples per row.
- `partial-debug-filmstrip.png`: the same sampled times and layout under the flow-debug mix.
- `beauty/reference/frame-012.png`: exact `+3` endpoint, including the tall right flame sheet and bright tip articulation that prediction misses.
- `beauty/predicted/frame-012.png`: R2 `+3` endpoint; the bowl, rim, upper haze, and occupied silhouette remain coherent, but the tall right sheet is absent.
- `partial-debug/predicted/frame-012.png`: R2 endpoint support diagnosis; broad transport remains active while low-confidence ranked births fill support without recovering exact lick topology.

The R1 thresholded-birth comparison is preserved in `../pyro-phase-transport-motion-0713/`. Its endpoint is visibly thinner and loses more upper support. R2 is the inspected final variant because it fixes that specific deletion failure without hiding the remaining forecast error.

## Corpus And Route

- Corpus: `/tmp/kaminos-phase-lag-tiger-world-key-r8-0713/phase-corpus.json`
- Corpus SHA-256: `51548442ececac255b3f94167e46428c39236d97ad767729d79d5ae51b0be534`
- Corpus authority: `live-simulator-controlled-step-selected-candidate-features-v0`
- Effective simulator route: `native-3d-compute-fluid-raymarch-v0`
- Feature contract: exact deployed 16-feature candidate order plus a directional 27-cell occupancy stencil; the deployed candidate contract itself is unchanged.
- Holdout episode: controlled-step indices `6..9`, or `0/160/320/480 ms` relative to `frame-6`.
- Training pairs: adjacent positive transitions wholly outside the holdout episode: `0->1`, `1->2`, `2->3`, `3->4`, `4->5`, `10->11`, and `11->12`.
- Backend/device: MLX, `Device(gpu, 0)`, runner `/private/tmp/kaminos-mlx-residual-venv/bin/python`, null fallback.
- Greenroom R1: job `f3a561967c14`, 217.913 seconds.
- Greenroom R2: job `5665109f63a0`, 1,418.071 seconds. The added cost is uncapped full-support recurrent local-grid key construction in Python, not additional GPU training capacity.
- R2 model SHA-256: `785ce32571aab2d5fe66b746f375bafcd57c85d5ab88442112fc3396b7af0747`
- R2 training report SHA-256: `7f584aa214fa3ab0af83497773aa4a747f83e8d24b8e269ca43d54f1642aae6b`
- R2 predictions manifest SHA-256: `fcab121ae28b934300d2b23d016ba6220f18622f6ed94b14e69bbf9f9f4622ba`
- Prediction payload retention: the manifest records the original hashes and byte counts for eight generated `.f32` files, but those volatile `/private/tmp/kaminos-phase-transport-full-r2-0713/` payloads were pruned after the rendered witness and receipts were verified. They are not represented as presently available evidence. Regenerate them from the preserved corpus and model using the commands below; see `r2-receipts/payload-retention.json`.

## Model And Support Semantics

The shared two-layer ReLU trunk emits 28 carrier classes: 27 bounded one-cell displacements plus death. A separate sigmoid head ranks births at empty sites in the directional local neighborhood. Supervision reserves exact same-site matches first, then performs one-to-one bounded local matching by candidate-feature distance. Unassigned targets are births; unassigned sources are deaths; matching ambiguity and carrier collisions remain explicit.

R1 selected births only above the training F1 threshold `0.85`. Training precision was `0.9145`, recall `0.3532`, and moving-class carrier accuracy was only `0.0903`. On held-out recurrence, only `862/1,304/2,074` births were selected, so support collapsed from 112,146 to 80,703, 70,264, and 64,394.

R2 keeps the same learned ranking but calibrates target count from the median full-training adjacent target/source ratio, `1.001414`. It admits the top unclaimed learned birth scores until that explicit count is reached. R2 support is 112,305, 112,464, and 112,623. At `+1`, only 994 of 32,464 selected births clear the old threshold; R2 therefore restores plausible support but must not be described as high-confidence birth localization.

## Quantitative Result

| Held-out step | Identity support IoU | R1 support IoU | R2 support IoU | R2 / identity |
| --- | ---: | ---: | ---: | ---: |
| `+1` | 0.3313 | 0.3556 | 0.3639 | 1.0986 |
| `+2` | 0.2366 | 0.2604 | 0.2693 | 1.1380 |
| `+3` | 0.1905 | 0.2074 | 0.2201 | 1.1557 |

| Full 13-frame render sequence | PSNR | SSIM | Endpoint non-background retention | Mean consecutive luma difference |
| --- | ---: | ---: | ---: | ---: |
| Exact reference | n/a | n/a | 101.1% | 1.4487 |
| Copied-current control | 23.7326 dB | 0.8143 | 100.0% | 0.0000 |
| R1 prediction | 21.8423 dB | 0.8019 | 85.5% | 1.1936 |
| R2 prediction | 22.3796 dB | 0.8054 | 93.1% | 1.2558 |

Support IoU favors learned transport at every held-out step and degrades smoothly. Rendered fidelity does not beat copied-current. R2 improves over R1, but at `+3` it remains `19.48 dB` PSNR versus control `21.14 dB`; its exact lick topology is wrong.

## Visual Verdict

R2 is a useful background-fire motion signal. It is temporally distinct, non-cyclic, and visibly coherent: the broad flame bowl, hot rim, upper haze, and rising/rolling motion survive three recurrent steps. It can plausibly desynchronize non-hero instances where different believable motion is itself useful and does not substitute for another analytical claim.

R2 is not a truthful nearby-phase forecast. It fails to recover the exact tall right flame sheet, smooths bright tip articulation, and uses a large low-confidence birth quota. Copied-current remains the better exact isolated-raster baseline. The evidence therefore supports `plausible learned motion diversity with a short coherent horizon`, not `phase-conditioned prediction beats identity` and not live integration.

No analytical raymarch comparison was made. The reference is the exact captured learned-splat target under the same isolated CPU raster, which is sufficient for this model/control comparison but not a statement about final fire appearance on a new radiance ridge.

## Commands

```sh
/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom submit \
  kaminos_phase_transport_mlx_train \
  /tmp/kaminos-phase-lag-tiger-world-key-r8-0713/phase-corpus.json \
  /private/tmp/kaminos-phase-transport-full-r2-0713

node boundary-splat-moving-phase-witness.mjs \
  --manifest /tmp/kaminos-phase-lag-tiger-world-key-r8-0713/phase-corpus.json \
  --predictions /private/tmp/kaminos-phase-transport-full-r2-0713/transport-predictions.json \
  --out-dir artifacts/pyro-phase-transport-motion-r2-0713 \
  --width 320 --height 240 \
  --frames-per-step 4 --fps 12 \
  --grid-step 0.0125 \
  --partial-flow-debug-gain 0.625

node video-filmstrip.mjs \
  --input artifacts/pyro-phase-transport-motion-r2-0713/beauty-comparison.mp4 \
  --out artifacts/pyro-phase-transport-motion-r2-0713/beauty-filmstrip.png \
  --report artifacts/pyro-phase-transport-motion-r2-0713/beauty-filmstrip.json \
  --frames 12 --columns 4 --thumb-width 320
```

## Artifact Identities

- `beauty-comparison.mp4`: `80945430aabde03cdd4bc058f88fcd69544fefe8123f397634e3dc42172b5ca2`
- `partial-flow-debug-comparison.mp4`: `5956a00ae9be5b81b7677f5b7cd2b5c20c1054be9c2c60648d18064ffa0a16b8`
- `beauty-filmstrip.png`: `1f1d9afa0fbabac2c71cb53fe4cd04c8d2bcacdd276110666a1aab5cf7ac377e`
- `partial-debug-filmstrip.png`: `c7a99101c5f95249862d719d4ef36df231f14c0b7b316f386305d9c0c5f91d81`
- `moving-phase-witness.json` records every rendered frame hash, requested/effective cadence, role authority, segment correspondence, route, and encoder probe.
- `r2-receipts/` preserves the compact model/training/prediction/Greenroom records. `payload-retention.json` distinguishes retained receipts from pruned, reproducible prediction tensors.
- `r2-metrics/` preserves per-frame PSNR, SSIM, and motion-energy diagnostics.
