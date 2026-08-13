# Polygonal Cat Cycle Two

Question: Does the selected polygonal-cat basin survive a second FLUX-to-3D
cycle, and does the second Trellis cast follow the second FLUX image closely
enough for iterative morphology authoring?

Result: Yes for this matched cell. The second FLUX pass remains recognizably in
the selected low-poly cat basin while making visible geometric edits. A second
Trellis reconstruction preserves that basin. After one global similarity fit
(translation, rotation, and uniform scale only), the cycle-1 and cycle-2 casts
register closely across the whole body while retaining coherent local residuals
at the head, neck, belly, hindquarter, feet, and tail. SF3D returns a cleaner
and more legible cat but smooths and thickens the form; Trellis preserves the
planar language more strongly but introduces dark striping and speckled texture
that are absent from the source.

## Route

- Repo: Kaminos
- Branch: `cc/molten-roundtrip-cycle2-registration-0813`
- Worktree: `/private/tmp/kaminos-molten-roundtrip-cycle2-registration-0813`
- Harness base commit: `ec25a712`
- Evidence command: `python3 await_cycle2.py`
- Completion: 2026-08-13T13:55:45Z, detached job supervisor exit 0
- Source: `source/second-flux.png`
- FLUX cell: `This shape as a cat.`, seed 80301, `flux2-klein-9b` q4,
  512x512, 8 steps, guidance 1.0
- Trellis route: `trellis2mlx_fast`, seed 42, 6 steps, target 200,000 faces,
  texture size 1024
- SF3D route: float16, texture resolution 1024, no remesh
- Render route: Blender 5.1.2 Workbench, textured orthographic six-view orbit
- Registration route: Blender 5.1.2, global similarity only, no local or
  anisotropic deformation

Exact effective commands and host paths are recorded in
`reconstruction-ledger.json`. Portable evidence locators are used for replay.

## Evidence

- `cycle-2-sheet.html`: causal sequence, complete Trellis and SF3D orbits, raw
  comparison, registration overlays, settings, and metric ceiling.
- `source/second-flux.png`: exact second-cycle input,
  `d811a766317a6d0ae2e13eb041e2043ef966dec22b920d5d65c8202860de62d9`.
- `reconstructions/trellis/output.glb`: second Trellis cast,
  `1057fcf61ecf4c610779a9eab6c52aa3550cdee529fca46306010a9b65f2b8e1`.
- `reconstructions/sf3d/output.glb`: second SF3D cast,
  `da9b82daf1990ecc9543e0841a30256e3284ea499e1693ebc13ae420fcd29cf9`.
- `registration/raw-side-by-side/`: native-scale, translation-only comparison.
- `registration/registered-overlay/`: cyan cycle 1 and orange cycle 2 after the
  single global fit.
- `registration/cycle-1-cycle-2-registration.blend`: inspectable Blender scene.
- `registration-result.json`: transform, route contract, portable cast locators,
  and bidirectional nearest-vertex diagnostics.

## Interpretation Boundary

The 1.0320 fitted scale and low residuals support gross shape stability for this
one matched causal cell. The residual is nearest-vertex distance normalized by
the cycle-1 cast diagonal; it is not continuous surface distance, anatomical
correspondence, topology evidence, or production reliability. The visual
overlays carry the primary morphology judgment. This episode does not prove
arbitrary-source convergence, repeated-cycle stability, or that a deliberate
local edit will survive. A held-constant local perturbation is the next assay.
