# Titan Hammer Source Cleanup - 2026-07-13

Source family: Crucible Bench observed splat, hammer candidate isolated by the first bench decomposition episode.

## Result

This slice cleaned the hammer source cutout into reconstruction-ready source variants, converted the existing Trellis geometry-only hammer mesh into a provisional GLB, and added a Kaminos viewer route hook plus two-angle witness for that GLB.

The useful progress is narrow but real: the GLB loads through the app, registers as a scene object, and visually reads as the bench hammer from front and oblique camera poses. It is not yet a finished tool cast. It has no texture, no topology repair, no collision approval, and no free-orbit production claim.

## Source Cleanup

Input:

- `artifacts/crucible-bench-shards-2026-07-13/masks/ball-peen-hammer-sam31/cutout-00.png`
- `artifacts/crucible-bench-shards-2026-07-13/masks/ball-peen-hammer-sam31/mask-00.png`
- Authoritative source image: `artifacts/crucible-bench-shards-2026-07-13/source/observed-bench-splat.png`

The deterministic cleanup used the primary SAM 3.1 hammer alpha/mask crop. It did not use image generation or inpainting.

Produced source variants:

- `source-cleanup/hammer-tight-rgba.png`
- `source-cleanup/hammer-padded-rgba.png`
- `source-cleanup/hammer-square-rgba.png`
- `source-cleanup/hammer-square-white.png`
- `source-cleanup/hammer-square-gray.png`
- `source-cleanup/hammer-mask-square.png`
- `source-cleanup/hammer-edge-debug.png`

The inspected contact sheet is `titan-hammer-source-cleanup-contact-sheet.png`. Visual read: the hammer body/head/handle are preserved, the background is normalized, and the alpha-derived edge still shows the source occlusion limits honestly.

Source cleanup receipt: `source-cleanup-receipt.json`.

## Mesh And Viewer Route

The existing Trellis raw geometry-only PLY from the first decomposition was converted to GLB:

- Source PLY: `artifacts/crucible-bench-shards-2026-07-13/mesh-firings/hammer-trellis-official-512-seed42/raw_mesh_geometry_only.ply`
- Output GLB: `provisional-glb/hammer-trellis-geometry-only.glb`
- Vertices: `86249`
- Triangles: `172980`
- GLB SHA-256: `319df2c62047abc4e8853303bd27273ba747e482be4737fbd155f34ff8532f11`
- Conversion receipt: `provisional-glb/hammer-trellis-geometry-only.glb.receipt.json`

Kaminos viewer support added:

- App hook: `window.kaminosImportGLBSceneObject(url, fileName, display)`
- Backing route: existing Greenroom GLB import path, `greenroomImportMesh(...)`
- Witness script: `witnesses/hammer-glb-viewer-witness.mjs`
- Witness receipt: `witnesses/hammer-provisional-glb-kaminos-witness.json`
- Front capture: `witnesses/hammer-provisional-glb-front.png`
- Oblique capture: `witnesses/hammer-provisional-glb-oblique.png`

Witness result: passed. The receipt records requested route, effective app URL, browser identity, registered scene-object metadata, camera poses, and screenshot paths.

Visual inspection of the witness captures:

- Front view: coherent ball-peen-like hammer silhouette; head, neck, and long handle are legible.
- Oblique view: geometry remains recognizable from a rotated camera; head and handle survive the viewpoint.
- Limit: surface is rough, grey/untextured, and visibly source-derived. Treat it as a provisional orbitability witness, not a production-ready asset.

## Preserved Miss

The first witness attempted to call `window.showGLB` directly. That failed because `showGLB` is internal to the app script and was not exposed as an agent-facing route hook. The failure is preserved in `witnesses/hammer-provisional-glb-prehook-failure.json`.

That miss was useful: it identified the missing viewer handoff API instead of letting the artifact pretend a raw URL or screenshot was a route receipt.

## GPU Route

Requested route:

- Greenroom job type: `sf3d`
- Job id: `20e3dfb7f43b`
- Input: `/private/tmp/kaminos-handy-candyman-crucible-shards-0713/artifacts/titan-hammer-source-cleanup-2026-07-13/source-cleanup/hammer-square-white.png`
- Output: `/private/tmp/kaminos-handy-candyman-crucible-shards-0713/artifacts/titan-hammer-source-cleanup-2026-07-13/mesh-firings/sf3d-white`
- Params: `texture_resolution=1024`, `remesh=none`, `dtype=float16`, `foreground_ratio=0.85`
- Final status: `done`, exit code `0`
- Effective route: `/Users/noahlyons/dev/sf3d/.venv/bin/python -u run_greenroom.py --image /private/tmp/kaminos-handy-candyman-crucible-shards-0713/artifacts/titan-hammer-source-cleanup-2026-07-13/source-cleanup/hammer-square-white.png --output-dir /private/tmp/kaminos-handy-candyman-crucible-shards-0713/artifacts/titan-hammer-source-cleanup-2026-07-13/mesh-firings/sf3d-white --texture-resolution 1024 --remesh none --dtype float16`
- Backend/device/model: Stable Fast 3D on MPS, `float16`
- Backend receipt time: load `64.24s`, inference `60.95s`, total `163.78s`
- Output GLB: `mesh-firings/sf3d-white/output.glb`
- Output GLB SHA-256: `8b8c4f0b4381d822d60eec7347cc95dcbf723de1abd59d9744c257512486ffa9`
- SF3D witness receipt: `witnesses/hammer-sf3d-white-kaminos-witness.json`
- SF3D witness captures: `witnesses/hammer-sf3d-white-front.png`, `witnesses/hammer-sf3d-white-oblique.png`

A prior relative-path submission, `3f29fb3df1bf`, was cancelled before execution because it carried a volatile output warning. The resubmitted job uses absolute paths. The status still reports `warnings: ["volatile_output"]`; this is preserved as route evidence, not suppressed.

Visual inspection of the SF3D captures:

- Front view: coherent hammer/T-tool silhouette, with a complete handle and cross-head.
- Oblique view: the form survives the camera move and remains recognizable.
- Limit: baked shadow/alpha texture became high-contrast black striping, and the proportions are stylized enough that this is a current best cast candidate, not a finished bench tool.

## Promoted Inventory

Promoted files gathered for operator smoke:

- `promoted/titan-hammer-source-square-white.png`
- `promoted/titan-hammer-mask-square.png`
- `promoted/titan-hammer-sf3d-white.glb`
- `promoted/titan-hammer-trellis-geometry-only.glb`
- `promoted/titan-hammer-sf3d-white-front.png`
- `promoted/titan-hammer-sf3d-white-oblique.png`

## Next Decision Boundary

The SF3D GLB is the current best cast candidate because it is compact, textured, and survives front/oblique viewer witness. The Trellis GLB remains useful as a source-faithful geometry fallback.

Next firing should repair the source image before reconstruction: remove baked dark striping and tray-shadow artifacts while preserving the hammer outline, then rerun SF3D or another mesh backend. If texture cleanup improves the source without distorting the head/handle, compare the new GLB against `promoted/titan-hammer-sf3d-white.glb` in the same two-angle witness route.

Do not call any hammer cast production-usable until a rotating-camera witness survives visual inspection and the intended interaction/collision contract is named.
