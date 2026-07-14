# Titan Hammer Realistic Source Generation

Date: 2026-07-13/14 UTC
Agent: `handy-candyman`

This episode responds to the operator sanity check that the prior neutral hammer source was plausible but too symbolic to be a good reconstruction input. The source image was being over-trusted by image-to-3D routes, so this pass used local image-generation conditioning to produce more realistic hammer sources before reconstruction probes.

## Result

`realistic-hammer-61014` through Trellis2MLX is the promoted current visual/orbitability candidate for the Titan Hammer source/GLB pair.

Promoted files:

- `promoted/titan-hammer-flux2-61014-source.png`
- `promoted/titan-hammer-trellis2mlx-fast-61014.glb`
- `promoted/hammer-trellis2mlx-fast-61014-front.png`
- `promoted/hammer-trellis2mlx-fast-61014-oblique.png`

Previous promoted source-realism/SF3D baseline files are preserved:

- `promoted/titan-hammer-flux2-61013-source.png`
- `promoted/titan-hammer-sf3d-flux2-61013.glb`
- `promoted/hammer-sf3d-flux2-61013-front.png`
- `promoted/hammer-sf3d-flux2-61013-oblique.png`

Visual verdict:

- The Flux2 source is a much more realistic object photograph than the prior procedural neutral repaint.
- Seed `61014` is a stronger Trellis source than seed `61013` because the angled prop-photo pose and head/handle material separation are more believable than the clean symmetrical front view.
- The Trellis2MLX GLB preserves the angled handle, carries a more complete hammer-head volume than the SF3D 61013 probe, and reads as a hammer in both front and oblique viewer captures.
- The Trellis texture is less shredded than the SF3D 61013 texture, though the lower handle still has simplified geometry and the head remains a single-image hallucinated reconstruction.
- The GLB is still a bounded asset candidate: not collision-approved, not topology-approved, and not final production geometry.

The best current hammer candidate is now `promoted/titan-hammer-trellis2mlx-fast-61014.glb`, replacing the SF3D 61013 candidate for visual/orbitability promise. It should still be treated as a prop candidate with viewer evidence, not as a finished interactable tool.

## Inputs

- `inputs/hammer-square-neutral-rebuild-conditioning.png`
- `inputs/hammer-mask-square.png`

The conditioning source is preserved as a pressure image only. It is not treated as source truth.

## Image Generation Route

Route: `mflux_flux2_edit_promptfile`

Effective runner family:

`/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit`

Configuration:

- Model: `flux2-klein-9b`
- Quantize: `4`
- Size: `512x512`
- Steps: `10`
- Guidance: `1.0`
- MLX cache limit: `48 GB`
- Conditioning input: `inputs/hammer-square-neutral-rebuild-conditioning.png`
- Prompt: `prompts/flux2-realistic-hammer-source.txt`

Four seeds were generated as a Molten-style first matrix: `61011`, `61012`, `61013`, and `61014`.

Visual read:

- `61011`: realistic tan handle and dark head, but the flat striking side is too rectangular/blocky.
- `61012`: cleanest reconstruction source image with no floor/shadow clutter, but SF3D dragged black/metal fragments down the handle.
- `61013`: best SF3D source; realistic source, tan handle survives SF3D, metal head survives, good front/oblique read.
- `61014`: best Trellis source; realistic angled source with stronger perspective and material separation for a geometry-first route.

## Reconstruction Routes

Two source images were probed through SF3D:

- `61012`, because it was the cleanest isolated source image.
- `61013`, because it was the strongest realistic source image.

Route: `sf3d`

Effective runner family:

`/Users/noahlyons/dev/sf3d/.venv/bin/python -u run_greenroom.py`

Configuration:

- Model: `stabilityai/stable-fast-3d`
- Device: `mps`
- Dtype: `float16`
- Texture resolution: `1024`
- Remesh: `none`
- Requested foreground ratio: `0.85`

Visual read:

- `sf3d-flux2-61012`: useful miss. The tan handle did not survive cleanly; dark torn material artifacts reappeared along the handle.
- `sf3d-flux2-61013`: promoted current candidate. The tan handle survives, the head reads as metal, and the shape is coherent from front and oblique views.

One source image was then probed through Trellis2MLX:

- `61014`, because the operator preferred the fourth image and direct inspection agreed it had the stronger prop-photo angle and head/handle material separation for Trellis.

Route: `trellis2mlx_fast`

Effective runner family:

`/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py`

Configuration:

- Seed: `61014`
- Resolution: `512`
- Steps: `8`
- Cascade: `--no-cascade`
- Target faces: `100000`
- Texture size: `512`
- Simplification: `--simplify-first`
- DINO/features route: MLX; stdout records `Features: (1, 1029, 1024) (MLX)`
- Texture baking route: MLX rasterizer at `512x512`

Timing and output:

- Greenroom job: `8b3fd2608978`
- Total: `121.4s`
- Mesh after cleanup: `50,232V / 100,855F`
- Output: `mesh-firings/trellis2mlx-fast-61014/output.glb`
- GLB size: `4.3MB`
- Receipt: `mesh-firings/trellis2mlx-fast-61014/greenroom-receipt.json`

Visual read:

- `trellis2mlx-fast-61014`: promoted current visual/orbitability candidate. The angled handle survives, the head has better spatial volume than SF3D 61013, and the object reads as a hammer from front and oblique viewer captures. It is not collision-approved or topology-approved.

## Viewer Evidence

The Kaminos viewer route loaded the SF3D and Trellis GLBs through `window.kaminosImportGLBSceneObject`, registered scene objects, and captured front plus oblique views.

Witness receipts:

- `witnesses/hammer-sf3d-flux2-61012-kaminos-witness.json`
- `witnesses/hammer-sf3d-flux2-61013-kaminos-witness.json`
- `witnesses/hammer-trellis2mlx-fast-61014-kaminos-witness.json`

The witness proves only viewer loading, scene registration, and two camera captures. It does not prove collision suitability, topology quality, free use from every camera, or final production readiness.

## Route Choice

The image-generation strategy follows the local imagegen calibration lesson: use Flux2 in a strong physical-object route first, then use reconstruction after the 2D source is visually plausible. The prior neutral repaint failed because it was too symbolic; this pass made the source more like a real captured object before asking SF3D to reconstruct it.

SF3D was used first as the fast apples-to-apples probe against earlier hammer candidates. After operator smoke preferred the fourth Flux2 source, Trellis2MLX was run on seed `61014` because a geometry-first route could plausibly preserve the stronger angled source better than SF3D. That expectation held visually in the Kaminos witness, so Trellis 61014 is now promoted over SF3D 61013 for visual/orbitability promise only.

## Comparison Sheet

- `trellis-comparison.html`

## Local Preflight

Before generation, the disk had only about `233 MB` free. Old `/private/tmp` browser/profile runtime directories older than one day were pruned, freeing roughly `22 GB`. No Greenroom output evidence was deleted.
