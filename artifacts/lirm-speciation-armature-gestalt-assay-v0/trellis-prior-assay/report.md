# LIRM Speciation Trellis Prior Assay

Date: 2026-07-10

## Scope

This assay checks whether the LIRM speciation armature can drive Trellis2MLX mesh generation from procedural implicit-body sources, and whether available Trellis route knobs expose a useful "ride more model prior" regime.

## Artifact Identity Repair

The interrupted loop exposed a mixed-version artifact tree. The old contact-sheet PNG/receipt mapped `lirm-armature-04` to `thread centipede` and `lirm-armature-22` to `trilobite flatback`, while the conditioning packages and actual Trellis inputs mapped `04` to `larval quadruped` and `22` to `slug loaf`.

Correction:

- Regenerated `contact-sheet`, `implicit-bodies`, and `conditioning-packages` from the same current code version.
- Verified contact receipt, implicit bundle, and conditioning package identity agree for selected IDs.
- Patched the contact-sheet writer so it emits a fresh `contact-sheet.png` alongside `contact-sheet.svg`; stale visual witnesses can no longer survive a successful writer run.
- Renamed Trellis result folders and render-review PNGs so the filesystem labels match the actual candidates.

Current selected identity anchors:

- `lirm-armature-04`: `lirm-larval-quad` / `stub-legged-ground-beast`
- `lirm-armature-22`: `lirm-slug-loaf` / `broad-belly-loaf`

## Source Contract Correction

The first Trellis runs used `source-maps/clay-control.png`. Those images are valid imagegen/control surfaces, but they are bad direct Trellis inputs: they are small objects on opaque dark raster canvases. Trellis treated the raster frame as a physical card.

Evidence:

- `edc540ebe0c1`: `lirm22-slugloaf-card-fast4-nocascade`, input `lirm-armature-22/source-maps/clay-control.png`, no-cascade 4 steps, produced a large rectangular source-card with partial creature mass behind it.
- `eb73242a9f5e`: `lirm22-slugloaf-card-fullcascade12`, same input through full cascade, still produced a large source-card. Full cascade made the card failure clearer, not better.
- `0f40300b81f6`: `lirm04-larvalquad-card-fast4-nocascade`, input `lirm-armature-04/source-maps/clay-control.png`, reconstructed the conditioning panel/plaque rather than the creature body.

Correction implemented:

- Added `trellis-source.svg/png` per conditioning package.
- `trellis-source.png` is 512x512, alpha-bearing, tight-cropped, transparent-background, object-only, using subdued clay material rather than control-map colors.
- Package receipt records `effectiveSource: tight-cropped-transparent-implicit-clay`, `background: transparent`, `crop: tight-surface-bounds`, and route candidates now name `trellisSource` as the Trellis input.

## Clean-Source Results

Clean-source A/B runs used the same Trellis route and seeds as the card failures where possible.

| Job | Candidate | Input | Route | Knobs | Duration | Visual verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `4595a555ca0e` | `lirm-armature-22` slug loaf | `trellis-source.png` | `trellis2mlx_fast` | seed 71022, steps 4, no cascade, 200k target faces, 1024 texture | 100.3s | Card failure gone. Produced a squat, multi-lobed crawling body preserving overall silhouette/gestalt, but with severe terraced/blocky surface artifacts. |
| `da6741ef6334` | `lirm-armature-04` larval quadruped | `trellis-source.png` | `trellis2mlx_fast` | seed 71004, steps 4, no cascade, 200k target faces, 1024 texture | 44.4s | Strong hit for a first cheap probe. Preserved U-shaped axis, terminal lobe masses, underside nubs, and the crude armature’s body gesture. Still rough and ugly, but clearly armature-driven. |

Visual read:

- Source prep alone caused the regime correction. The same model route stopped building cards once the source became alpha-bearing, tight-cropped, object-only clay.
- The armature is capable of driving Trellis with much more specificity than the crude source deserves.
- Four-step no-cascade is good enough as a cheap sanity probe for "does the body identity survive?", but not good enough for attractive final mesh quality.
- The current strongest control surface is source-side silhouette/gestalt design, not exposed Trellis CFG.

## Knob Surface

Immediate accessible knobs:

- `steps` on `trellis2mlx_fast`, still no-cascade.
- Cascade vs no-cascade through `trellis2mlx` vs `trellis2mlx_fast`.
- `target_faces`, `texture_size`, `seed`, and source render preparation.

True image-to-3D CFG/guidance knobs are not currently exposed by the Greenroom route. In `generate.py`, normal image-to-3D shape sampling has hardcoded shape guidance strength/rescale/interval. VS3D edit mode exposes CFG-like knobs, but that is a different route and is not yet the correct raw LIRM source assay.

Completed knob probes on `lirm-armature-04`:

| Job | Candidate | Input | Route | Knobs | Duration | Visual verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `da6741ef6334` | `lirm-armature-04` larval quadruped | `trellis-source.png` | `trellis2mlx_fast` | seed 71004, steps 4, no cascade, 200k target faces, 1024 texture | 44.4s | Best cheap identity probe so far. Rough surface, but the source gesture survives. |
| `62adae8d709f` | `lirm-armature-04` larval quadruped | `trellis-source.png` | `trellis2mlx_fast` | seed 71004, steps 8, no cascade, 200k target faces, 1024 texture | 67.9s | Smoother and cleaner than fast4, but it sands down segment rhythm and gesture. Useful when prettier preview matters; weaker as a sensitivity probe. |
| `6995416190f7` | `lirm-armature-04` larval quadruped | `trellis-source.png` | `trellis2mlx` | seed 71004, full cascade/default steps, 512 resolution, 200k target faces, 1024 texture | 89.3s | Preserves broad mass and some lobing, but introduces block/voxel-like surface terraces. Not a clear preview win over fast4/fast8. |

Knob verdict:

- "Force harder" is live, but not monotonic magic.
- Fast8 is visually cleaner, but it appears to average away some armature-specific structure.
- Full cascade is not automatically the creative/asymmetry lever for crude creature sources.
- More silhouette/gestalt spread is a stronger next experiment than spending more time on the same candidate’s current Trellis knobs.

## Next Fanout Boundary

Recommended next fanout: run clean-source `trellis2mlx_fast` 4-step probes across a deliberately diverse set of current-code candidate identities:

- `lirm-armature-00`: pillbug dome / armored oval dome
- `lirm-armature-02`: comma grub / curled comma grub
- `lirm-armature-03`: trilobite flatback / flat wide side plates
- `lirm-armature-05`: shell kite / wide diamond shell
- `lirm-armature-07`: tadpole pouch / big head taper tail

Decision boundary:

- If at least two new gestalts preserve identity at fast4, continue treating silhouette/gestalt as the main control layer and queue a small imagegen stylization pass before Trellis.
- If only larval/slug-style bodies survive, bias the armature generator toward rounded continuous mass and add detail as semantic texture rather than topology.
- If shell/flat gestalts survive, this route can start issuing useful creature family candidates immediately.
