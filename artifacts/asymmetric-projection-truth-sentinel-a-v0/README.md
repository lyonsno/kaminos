# Native-square asymmetric projection sentinel A

Question: Can a generator preserve a deliberately asymmetric, noncanonical source projection when target geometry and appearance are supplied through separately typed carriers?

Result: The source bundle supplies one 512×512 orthographic projection with pixel-visible image-right orientation, a distinct cranial marker, an offset dorsal landmark, four ordered supports, and one protected contour. Clay, depth, normal, silhouette, contour, and landmark images all share the same native-square raster identity. The manifest predeclares exact categorical checks, a maximum landmark drift of 0.05 frame diagonal, and a minimum protected-contour IoU of 0.80.

Route:

- repo: `lyonsno/kaminos`
- worktree: linked feature worktree; exact local path is recorded in the private consumer handoff rather than this public artifact
- producer commit: `1ca951e283a9aeab89e5ebf5bc11d095203e7658`
- branch: `cc/source-plate-workbench-0803`
- command: `python3 source_plate_visible_sentinel.py --output-dir artifacts/asymmetric-projection-truth-sentinel-a-v0`
- requested producer: `python-stdlib-analytic-raster-v0`
- effective producer: `python-stdlib-analytic-raster-v0`
- renderer/device: `deterministic-cpu-raster` / Apple Silicon CPU (`arm64`)
- fallback: none
- model/checkpoint: not applicable; deterministic analytic raster source
- resolution/preprocessing: `512×512`; native-square identity transform; no crop, pad, or scale
- generated: `2026-08-05T00:48:28Z`
- manifest SHA-256: `31d2f3d62a0ae27ad6c88c2ff0f452572cefa2a37c41fa9e80819644f4826c20`

Images:

- `clay.png`: neutral appearance carrier with an orange image-right marker.
- `depth.png`: target-projection carrier for the depth-only and depth-plus-appearance cells.
- `normal.png`: view-space normal carrier from the same analytic depth field.
- `silhouette.png`: binary full-source silhouette.
- `protected-contour.png`: binary mask used for the predeclared IoU gate.
- `landmark-overlay.png`: the clay carrier with all predeclared landmarks drawn over the source pixels.
- `index.html`: self-contained visual experiment plate with all images, hashes, evidence thresholds, and consumer topology.

Does not prove: generator projection retention, reconstructed 3D geometry, organic morphology transfer, or a general ranking among conditioning carriers. Those claims require consumer outputs evaluated against this predeclared pixel evidence.
