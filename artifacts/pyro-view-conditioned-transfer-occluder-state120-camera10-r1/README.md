# View-Conditioned Transfer Scene-Depth Occlusion Falsifier

Question: Do the compressed transfer groups preserve useful appearance when opaque scene geometry interrupts a camera ray inside a composed depth span?

Inspect `annotated-occluder-sheet.png` directly. Native images are the primary evidence.

Roles:
- `unoccluded-reference.png`: exact adapted 96-bin black-background control.
- `exact-occluded-reference.png`: exact adapted 96-bin transfer interrupted by the three matte-black plates; metric reference.
- `occluder-depth-map.png`: the exact per-pixel scene-depth fixture; blue is near, red is far, black has no geometry.
- `d12-t2-occluded.png`, `d12-t2-occluded-residual.png`, and `d12-t2-occlusion-specific-residual.png`: d12-t2 composed through the same three opaque depths, its total residual, and the residual after subtracting its unoccluded compression error.
- `d12-t4-occluded.png`, `d12-t4-occluded-residual.png`, and `d12-t4-occlusion-specific-residual.png`: d12-t4 composed through the same three opaque depths, its total residual, and the residual after subtracting its unoccluded compression error.

Geometry: `interleaved-intragroup-plates-v0` with depth policy `alternating-quarter-span-v0`. Every finite plate depth lies strictly inside an authenticated compressed depth span. This is deliberately adversarial to representative-depth grouping.

Route:
- generator worktree: `/private/tmp/kaminos-pyro-view-conditioned-transfer-compression-0717`
- generator commit: `620d0a66d63757016a09060ce3c2e65ebc904ec9`
- command: `/private/tmp/kaminos-mlx-residual-venv/bin/python /private/tmp/kaminos-pyro-view-conditioned-transfer-compression-0717/view-conditioned-transfer-occluder-witness.py --input-manifest /private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/input-manifest.json --geometry interleaved-intragroup-plates-v0 --occluder-rgb 0,0,0 --treatment d12-t2=/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/reductions/d12-t2/report.json --treatment d12-t4=/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/reductions/d12-t4/report.json --out-dir artifacts/pyro-view-conditioned-transfer-occluder-state120-camera10-r1`
- source manifest: `/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/input-manifest.json` (`c07a37517ad736ea69128984b8ef65bc8682a7df0668c2593246ce547d205c35`)
- transfer arrays: `/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/transfer-field.npz` (`4f37287be81ae00e23ff73c9a1d053ae3c251b492f07c722672bbad686f0a6f7`)
- source route/backend: `state120-coefficient-plane-export-v0` / `numpy-cpu-v0`
- witness backend: `numpy-cpu-v0`; fallback: false

Does not prove: analytical-raymarch parity, arbitrary mesh raster/depth integration, adjacent-camera validity, dynamic rebuild cost, temporal stability, GPU render cost, or production economics.
