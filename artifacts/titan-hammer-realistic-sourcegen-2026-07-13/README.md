# Titan Hammer Realistic Source Generation

Date: 2026-07-13/14 UTC
Agent: `handy-candyman`

This episode responds to the operator sanity check that the prior neutral hammer source was plausible but too symbolic to be a good reconstruction input. The source image was being over-trusted by image-to-3D routes, so this pass used local image-generation conditioning to produce more realistic hammer sources before another SF3D probe.

## Result

`realistic-hammer-61013` is the promoted current candidate for the Titan Hammer source/GLB pair.

Promoted files:

- `promoted/titan-hammer-flux2-61013-source.png`
- `promoted/titan-hammer-sf3d-flux2-61013.glb`
- `promoted/hammer-sf3d-flux2-61013-front.png`
- `promoted/hammer-sf3d-flux2-61013-oblique.png`

Visual verdict:

- The Flux2 source is a much more realistic object photograph than the prior procedural neutral repaint.
- The tan wooden handle survives the SF3D reconstruction.
- The head reads as dark metal and the overall object reads as a hammer from front and oblique viewer captures.
- The GLB is still a bounded asset candidate: not collision-approved, not topology-approved, and not final production geometry.

The best current hammer candidate is now `promoted/titan-hammer-sf3d-flux2-61013.glb`, replacing the earlier hammer only for source-realism/source-to-SF3D visual quality. It should still be treated as a prop candidate with viewer evidence, not as a finished interactable tool.

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
- `61013`: best end-to-end candidate; realistic source, tan handle survives SF3D, metal head survives, good front/oblique read.
- `61014`: realistic angled source, but weaker as a reconstruction input than 61013.

## Reconstruction Route

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

## Viewer Evidence

The Kaminos viewer route loaded both GLBs through `window.kaminosImportGLBSceneObject`, registered scene objects, and captured front plus oblique views.

Witness receipts:

- `witnesses/hammer-sf3d-flux2-61012-kaminos-witness.json`
- `witnesses/hammer-sf3d-flux2-61013-kaminos-witness.json`

The witness proves only viewer loading, scene registration, and two camera captures. It does not prove collision suitability, topology quality, free use from every camera, or final production readiness.

## Route Choice

The image-generation strategy follows the local imagegen calibration lesson: use Flux2 in a strong physical-object route first, then use reconstruction after the 2D source is visually plausible. The prior neutral repaint failed because it was too symbolic; this pass made the source more like a real captured object before asking SF3D to reconstruct it.

Trellis was not run in this slice. The source-reality question came first, and SF3D is the fastest apples-to-apples probe against the earlier hammer candidates. Trellis remains the next route if the hammer needs stronger spatial completeness, interaction, collision work, or a geometry-first comparison after the 61013 source has been accepted as the better image source.

## Local Preflight

Before generation, the disk had only about `233 MB` free. Old `/private/tmp` browser/profile runtime directories older than one day were pruned, freeing roughly `22 GB`. No Greenroom output evidence was deleted.

