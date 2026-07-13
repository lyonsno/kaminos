# Phase-Matched Smoke Motion Diagnosis

Question: Does the real hierarchical smoke-splat product produce coherent articulated smoke when phase-offset instances are rendered as standalone optical extinction?

Result: No. The exact products animate and instance successfully, but the corrected raster still reads as a cuboid. The authoritative phase contains 7,964 coarse splats out of 8,000 possible `8^3` coarse cells; the held-out learned phase contains 7,968. Preserving all coarse extinction therefore makes the nominally sparse hierarchy nearly dense before the articulated fine residual is resolved. This is representation anti-evidence, not visual closure.

## Route

- repo: `/Users/noahlyons/dev/kaminos`
- worktree: `/private/tmp/kaminos-handy-live-splat-smoke-0713`
- branch/base: `cc/handy-live-splat-smoke-0713` at base commit `630614d` plus the witness implementation preserved with this directory
- live route: `http://127.0.0.1:8237/smoke-splat-motion.html?route=webgpu-real-field-hierarchical-smoke-motion-v0&instances=4&fine_lod=1&motion_rate=0.16`
- effective renderer: `webgpu-real-field-hierarchical-smoke-motion-v0`
- backend/device: `WebGPU:apple`
- temporal authority: `velocity-carried-short-horizon-extrapolation-v0`
- source manifest: `../real-smoke-hierarchy-0713/motion-source.json`
- phase 0 artifact: `../real-smoke-hierarchy-0713/sim-step-96-target.splats.f32`, SHA-256 `757f20d47ca0eb680c51433231df012b8fb600bd891c4e3d982fbd724f0f0efe`
- phase 1 artifact: `../real-smoke-hierarchy-0713/sim-step-97-learned.splats.f32`, SHA-256 `ba5009179d42d64b5d825c31cacf9ef4ddf8a8107a50bfc0654f076af150430e`
- capture interval: see `startedAt` and `completedAt` in `report.json`

## Commands

```sh
python3 serve.py 8237
node smoke-splat-motion-witness.mjs \
  --url 'http://127.0.0.1:8237/smoke-splat-motion.html?route=webgpu-real-field-hierarchical-smoke-motion-v0&instances=4&fine_lod=1&motion_rate=0.16' \
  --out-dir artifacts/smoke-splat-motion-video-0713 \
  --frames 48 \
  --step-ms 50 \
  --settle-ms 1600 \
  --chrome-port 19419
ffmpeg -y -framerate 20 \
  -i artifacts/smoke-splat-motion-video-0713/frame-%03d.png \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  artifacts/smoke-splat-motion-video-0713/smoke-splat-motion.mp4
```

## Evidence

- `smoke-splat-motion.mp4`: 48 live frames, 2.4 seconds at 20 fps; four instances bind two unique uploaded products with phase offsets.
- `report.json`: requested/effective route, fallback state, product identities, draw plan, browser timing authority, frame hashes, and false-closure checks.
- `run-001-overintegrated-four.png`: first raster, whose arbitrary optical-depth multiplier produced dark extinction bricks.
- `run-002-area-normalized-four.png`: corrected mass-per-projected-area raster and oblique camera; the box survives.
- `run-003-area-normalized-single.png`: isolated authoritative product; overlap is not the cause of the box.
- `frame-000.png` through `frame-047.png`: raw CDP page captures used to encode the MP4.

## Important Hashes

- `run-001-overintegrated-four.png`: `d46854de037a39f34dadbee06f70d80fcc53d979da740a2b242036af33041dbc`
- `run-002-area-normalized-four.png`: `c44e3a7871edea6888ea5dc140cf50ef189cb494747fc845ad7f0682af4f9f4e`
- `run-003-area-normalized-single.png`: `25e34e6a0a257b51561c0efa0176a4ee47b4357ce1ec563f90fe7051617f028a`
- `smoke-splat-motion.mp4`: `dd3eac45057168af4a1d2e76f64596b8cf39941f1ca033ad6c63d785ed7089bb`
- `report.json`: `2adfc2a30b714be19edfd8bb9aa0907611022fe068383a45db59eeccfdef7a93`

Does not prove: final flame-smoke depth composition, live recurrent smoke decode, long-horizon temporal coherence, isolated GPU duration, or that a mass-preserving sparse coarse consolidation cannot solve the cuboid. Browser timing is RAF plus CPU submission authority only.
