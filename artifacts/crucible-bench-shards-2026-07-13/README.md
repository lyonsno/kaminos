# Crucible Bench Shard Episode: 2026-07-13

Lane: `handy-candyman`  
Branch: `cc/handy-candyman-crucible-shards-0713`  
Source image: `source/observed-bench-splat.png`  
Source SHA-256: `805f495e3aa8a660579467c643700af1a5074185fd3fb612b2c2245affed43d7`

## Source Envelope

This public artifact folder preserves the Wake Crucible Bench observed image by local copy and SHA-256. The full private coordination envelope is intentionally kept outside this public repo; this report carries only the source hash, local source image, and route receipts needed to inspect the generated assets.

The authoritative bench image was inspected directly. It contains a smoked, baked-light workspace with a specimen tray and slots near center, a ball-peen hammer across the lower middle, a right-side tool cluster, a noisy vice/anvil-like block candidate, worn tabletop material, and capture-edge dreaminess around the source envelope.

## Ranked Candidates

1. `specimen-tray`: visually strongest source-armature shard. SAM3.1 produced a broad tray mask that is useful for tray/slot vocabulary but not yet a clean slot-level cast.
2. `ball-peen-hammer`: best orbitability-seeking candidate. SAM3.1 found a clean top hammer cutout plus false-positive neighbors; the clean cutout fired through Trellis.
3. `right-tool-cluster`: useful tool-clutter vocabulary, but SAM3.1 output is noisy and not promoted as a clean cast.
4. `surface-board`: strong partial-view material shard. Fired through Sharp and then into the Kaminos splat inbox as a bounded point-cloud preview.
5. `capture-edge`: useful image-space grammar; SAM3.1 produced no detections, so it remains a shard rather than a reconstruction input.
6. `vice-anvil-block`: demoted after visual inspection. The crop and SAM3.1 output are too occluded/noisy for an honest cast route in this episode.

No broad candidate set was hidden or capped. Six candidates were preserved in `crops/`, with initial and corrected SAM3 receipts under `masks/`.

## Route Receipts

SAM3 isolation used GPU Greenroom job type `sam3_isolate_handy_candyman_0713`. The first requested model, `mlx-community/sam3-image`, failed during `load_model` because the local snapshot had no config; each failed receipt was preserved. The corrected effective model was `mlx-community/sam3.1-bf16` from local snapshot `a992e302ea9b0f03f41dfd93414a4fd0e818f65b`.

Corrected SAM3.1 jobs:

- `specimen-tray`: `d860c0fec84d`
- `ball-peen-hammer`: `bf4d43f20558`
- `right-tool-cluster`: `34f851c11d47`
- `vice-anvil-block`: `cf25522ece1d`
- `surface-board`: `5e77fae5a496`
- `capture-edge`: `ffedd8e026fa`

Sharp partial-view firing:

- Job: `d325a3df1aaa`
- Effective route: `/Users/noahlyons/dev/ml-sharp/.venv/bin/sharp predict -i crops/05-surface-board.png -o view-firings/surface-board-sharp --device mps --no-render`
- Duration: `15.7s`
- Output: `view-firings/surface-board-sharp/05-surface-board.ply`
- Local witness: `witnesses/surface-board-sharp-pointcloud-multiangle.png`
- Point count: `1,179,648`
- Contract: partial-view fidelity only; not freely orbitable.

Trellis orbitability-seeking firing:

- Job: `88a279fccd92`
- Effective route: `trellis2_official_512_seeded`
- Backend: local reference `trellis-mac` on PyTorch MPS with `ATTN_BACKEND=sdpa`, `SPARSE_ATTN_BACKEND=sdpa`, and `PYTORCH_ENABLE_MPS_FALLBACK=1`
- Source: `masks/ball-peen-hammer-sam31/cutout-00.png`
- Timings: pipeline load `90.51s`, pipeline run `74.61s`
- Output: `raw_mesh.npz`, converted to `raw_mesh_geometry_only.ply`
- Metrics: `86,249` vertices, `172,980` faces, `5,069` boundary edges, `4,712` non-manifold edges, `30,732` same-direction conflict edges
- Local witness: `witnesses/hammer-trellis-rawmesh-multiangle.png`
- Contract: recognizable hammer geometry only; no texture, no final GLB, no collision approval, no Kaminos viewer registration.

## Kaminos Viewer Route

Supported single-asset viewer route was recorded for the Sharp surface-board PLY:

- Requested URL: `http://127.0.0.1:8096/`
- Scenario: `splat-asset-inbox`
- Server root: `/private/tmp/kaminos-handy-candyman-crucible-shards-0713`
- Mount: `KAMINOS_SPLAT_INBOX_DIR=artifacts/crucible-bench-shards-2026-07-13/view-firings/surface-board-sharp`
- Effective source route: `/api/read?root=splat-inbox&path=05-surface-board.ply`
- Witness screenshot: `witnesses/surface-board-sharp-kaminos-splat-inbox.png`
- Witness report: `witnesses/surface-board-sharp-kaminos-splat-inbox.json`
- Registration evidence: asset row `05 Surface Board`, stage `experimental`, preview kind `point-cloud`, point count `1,179,648`
- Explicit non-claim: `realSplatRendering=false`, canvas mode `three-point-cloud-preview`

The screenshot was visually inspected. It shows the colored point-cloud Crucible Bench shard in the Kaminos viewport, with the `05 Surface Board` asset row visible in Greenroom.

## Promoted Inventory

Promoted operator-facing copies live in `promoted/` after report generation. The promotion set includes the source image, contact sheets, key SAM3 overlays/cutouts, the Sharp PLY and Kaminos witness, and the Trellis geometry-only PLY plus route reports and local witness.

## Useful Misses

- Right tool cluster: kept as image/mask vocabulary, not a cast.
- Vice/anvil-like block: tempting, but visually too broad and blurred; reconstruction would overclaim.
- Capture-edge: SAM3 found no object; preserve as image-space capture grammar rather than erasing it as damage.
- Initial SAM3 backend request: useful failure. The job did not silently fall back; receipts name `load_model` failure and the corrected SAM3.1 route.
- Trellis GLB: not emitted because of the known MPS texture-bake mismatch; the raw mesh is still useful as a geometry witness, but not a complete cast.

## Exact Next Decision Boundary

The next overdetermined step is a tighter hammer cleanup/reconstruction pass: use the visually inspected SAM3 hammer cutout as source, repair the residual cutout softness if needed, then rerun a mesh route that emits GLB or another Kaminos-supported geometry cast with a rotating viewer witness. In parallel, the surface-board Sharp PLY can be kept as a bounded point-cloud material shard for bench dressing, with the explicit view-cone and non-real-Gaussian-rendering contract intact.
