# Sparse coarse smoke consolidation v1

Question: Can a mass-relative, uncapped coarse anchor reduction remove the dense cuboid silhouette without discarding extinction or destroying adjacent-phase identity?

Result: Yes for the coarse hierarchy, but not yet for the complete smoke product. The corrected v1 path reduces `7,964` source coarse bins to `341` anchor splats for step 96, preserves all `3.4296106743` source extinction mass, and shares `333` coarse spatial keys with the adjacent phase. The coarse-only frame no longer forms a domain-sized cuboid. Enabling the current fine articulation layer restores a faint upper cuboid, so fine occupancy selection is the next named failure.

## Route receipt

- Repo: `/Users/noahlyons/dev/kaminos`
- Worktree: `/private/tmp/kaminos-handy-live-splat-smoke-0713`
- Branch: `cc/handy-live-splat-smoke-0713`
- Initial capture base: `585c5095d3626b9ed3ad79fc007b779b77f9987e`; the durable-route recapture uses the revision-one commit containing this bundle
- Source frames: `/private/tmp/kaminos-splat-good-basin-full-grid-160-replay96-v1/manifest.json` and `/private/tmp/kaminos-splat-good-basin-full-grid-160-replay97-v1/manifest.json`
- Source route: `native-3d-compute-fluid-raymarch-v0`, deterministic simulator steps 96 and 97, grid 160
- Product route: `authoritative-full-grid-real-smoke-hierarchy-corpus-v0`
- Viewer route: `webgpu-real-field-hierarchical-smoke-motion-v0`
- Backend: `WebGPU:apple`
- Coarse selector: `mass-preserving-anchor-voronoi-v1`, ratio `0.8`, no capacity cap
- Spatial authority: `anchor-bin-only-tail-optical-transfer-v0`

Corpus command:

```sh
node scripts/compile-real-smoke-splat-corpus.mjs \
  --frame /private/tmp/kaminos-splat-good-basin-full-grid-160-replay96-v1/manifest.json \
  --frame /private/tmp/kaminos-splat-good-basin-full-grid-160-replay97-v1/manifest.json \
  --out-dir artifacts/smoke-coarse-consolidation-v1-0713 \
  --coarse-block-size 8 \
  --fine-block-size 4 \
  --articulation-threshold 0.5 \
  --fine-mass-fraction 0.5 \
  --coarse-anchor-mass-ratio 0.8 \
  --instance-count 4 \
  --phase-slot-count 2
```

Durable full-route smoke URL:

```text
http://127.0.0.1:8237/smoke-splat-motion.html?route=webgpu-real-field-hierarchical-smoke-motion-v0&manifest=./artifacts/smoke-coarse-consolidation-v1-0713/motion-source.json&instances=4&fine_lod=1&motion_rate=0.16
```

Durable coarse-only diagnostic URL:

```text
http://127.0.0.1:8237/smoke-splat-motion.html?route=webgpu-real-field-hierarchical-smoke-motion-v0&manifest=./artifacts/smoke-coarse-consolidation-v1-0713/motion-source.json&instances=1&fine_lod=0&motion_rate=0.16
```

`coarse-only-witness-report.json` and `full-route-witness-report.json` were regenerated directly against the durable artifact manifest on 2026-07-13. Both reports retain the artifact-relative manifest path in `requestedUrl` and live runtime state, along with requested/effective route, fallback state, browser identity, frame timing, and all eight frame hashes. Their PNG sequences live in `coarse-only-frames/` and `full-route-frames/`. `report.json` is the portable corpus report hashed by `motion-source.json`.

## Images

- `baseline-dense-cuboid.png`: the original unconsolidated hierarchy; near-domain occupancy reads as a solid cuboid.
- `v0-full-moment-coarse-only.png`: failed consolidation experiment; transferring tail spatial moments makes a few domain-sized splats and recreates the box.
- `v0-full-moment-full-route.png`: the same failed geometry with fine articulation enabled.
- `v1-anchor-geometry-coarse-only.png`: corrected coarse result; anchor bins own geometry while tail bins transfer only optical/material mass. The cuboid is gone, though the transport support remains visibly lumpy.
- `v1-anchor-geometry-full-route.png`: complete four-instance route. A faint tall cuboid remains and is attributable to the fine layer because it is absent from the coarse-only frame.
- `coarse-only-frames/frame-003.png`: directly inspected frame from the durable-manifest coarse-only recapture.
- `full-route-frames/frame-003.png`: directly inspected frame from the durable-manifest four-instance recapture.

## Important hashes

- `baseline-dense-cuboid.png`: `25e34e6a0a257b51561c0efa0176a4ee47b4357ce1ec563f90fe7051617f028a`
- `v0-full-moment-coarse-only.png`: `54a33cf6883f9834f9d36d2518de76ee2f9f1045da0c2c6617e3e6eb404226d5`
- `v0-full-moment-full-route.png`: `949d6cb127c75ba03d0db9ff96f19d1108fec1cb92e7591a957dc3bfde737538`
- `v1-anchor-geometry-coarse-only.png`: `260f214496cb2ced403e0ad0593d4933841db71ab738c9d138ee1c7767a5bef1`
- `v1-anchor-geometry-full-route.png`: `98beb5cb4e15eb6e70d47f4f7847cd4c3026a7931fb14b517f8cf37b25355e91`
- `sim-step-96-target.splats.f32`: `c4c0ca096868c54dd5e0eebc9aed51e4968d4aa1b5280fda3457a8ab2d56bc26`
- `sim-step-97-learned.splats.f32`: `3b38ac7725e6329343230f53fc6460b59c6a601fe25a9f2e370c6d6ab743840d`
- `report.json`: `75ae920b74d1da5ca4af225c9cca8c3dfe92d5e8c5df43ea65e64c0bda23756b`
- `motion-source.json`: `e1b20940c6bfa25606a7c0d8bcec9270b6207453892d6561102d0a0a390fd2d4`
- `coarse-only-witness-report.json`: `da471ccbadb5499a130e8bac2b4565ee9b6ba84dc61896578d89cd79bf28bfcb`
- `full-route-witness-report.json`: `a4a1cc488685aec8c79f50b7689a8c4b18453138864025dbec84ed52112c1f7f`
- `coarse-only-frames/frame-003.png`: `cadc0403d7c0c862172ce5133804867d6254ebb7db4710d676be5f49a6279716`
- `full-route-frames/frame-003.png`: `f413d5fa26e521c5ff33260dedabdc2c63eb1e97ec20a9069e2f2ca79c9ab250`

## Claim boundary

This evidence proves a material improvement to coarse occupancy and localizes the remaining box silhouette to the emitted fine layer. It does not prove finished smoke appearance, final flame/smoke depth composition, recurrent neural smoke decode, camera generalization, or production frame cost. The coarse-only candidate is sparse and truthful enough to diagnose, not visually complete enough to ship.
