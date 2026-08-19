# Skull-Muzzle Reconstruction Matrix

This operator package compares image-to-3D routes for the seven-seed, three-column skull-muzzle source matrix generated from the prompt `Complete this skull into a living animal head.`

## Current Route Decision

The first assay used source cell `81402-long` with Greenroom job `bcb28ace4663` through `trellis2mlx_fast_checkpoint`: seed 81402, 512 resolution, 8 no-cascade steps, 100000 target faces, 512 texture, simplify-first, and checkpoint preservation. The effective runner was `/Users/noahlyons/dev/trellis2mlx/.venv/bin/python`, and stdout proved MLX DINO features and MLX texture rasterization.

Trellis completed in 245.3 seconds and preserved recognizable head volume, ears, and muzzle projection. It did not clear the visual or structural predicate: the eyes became deep cavities, fur became shredded relief, and the raw mesh reached 2,819,695 vertices and 7,078,908 faces before heavy simplification and cleanup. The GLB remains a useful miss under `probe-81402-long-trellis/`; it is not a promoted creature head.

The complete 21-cell matrix is therefore routed through Greenroom SF3D with texture resolution 1024, no remesh, and float16 on the effective PyTorch/MPS route. The off-repo accountability root is `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-handy-skull-muzzle-matrix-0819/`.

## Evidence Boundary

Greenroom completion proves execution, not visual quality. Each spatial candidate must pass structural output checks and be inspected against its exact source image through a Kaminos direct asset route and multi-angle witness before ranking. No current result claims anatomical correctness, collision, animation, production topology, or unseen-view fidelity.

## Operator Route

The exercised Trellis route is:

`http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-matrix-2026-08-19%2Fprobe-81402-long-trellis%2Fmesh%2Foutput.glb`

The server is the Kaminos worktree `/private/tmp/kaminos-handy-candyman-skull-muzzle-0819` running `python3 serve.py 8104`. Route registration evidence is `probe-81402-long-trellis/witnesses/81402-long-direct-route.json`; visual front and oblique evidence is `probe-81402-long-trellis/witnesses/81402-long-multiangle.json`.

## Current Status

All 21 SF3D jobs have distinct Greenroom ids and terminal output directories. The first job is `6fd56df02dc5` for `81402-long`; operator-priority rows `81408` and `81406` follow before the remaining rows. Final ranking and promotion remain pending visual inspection of the emitted GLBs.
