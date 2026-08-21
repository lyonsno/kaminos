# Horned Skull Blender Shortlist

Question: Do the four operator-selected TRELLIS casts remain visually strong
in a renderer that can evaluate two-sided materials without Kaminos GTAO, and
are their winding defects bounded rendering defects or hard blockers for the
intended use?

Result: all four are coherent orbitable visual casts, and the operator's shared
Eevee scene renders all four attractively across frontal, oblique, profile, and
rear arrangements without the severe backface and GTAO ghosts seen in the
Kaminos viewer. Identity-hybrid 81421 has the strongest naturalistic facial
assembly and sculptural volume. Feature-animation is the cleanest stylized
cast. Faceted 81413 retains a strong angular character read, while
identity-hybrid 81422 is coherent but visibly rougher. The feature-animation
rear still has several visible gaps. Mixed or damaged winding and actual holes
remain distinct defects, but winding is no longer a blanket blocker for static
beauty rendering under the demonstrated Eevee route.

The four top-level GLBs are relative symlinks to the canonical assay outputs,
so Blender opens the original artifacts without another copied mesh:

- `01-identity-hybrid-trellis-81421.glb`: FLUX identity-hybrid source seed
  81416, TRELLIS seed 81421, Greenroom job `5dfac5a7b3a0`.
- `02-feature-animation-trellis-81414.glb`: FLUX feature-animation source seed
  81412, TRELLIS seed 81414, Greenroom job `da74d654295c`.
- `03-faceted-trellis-81414.glb`: FLUX faceted-fur-planes source seed 81413,
  TRELLIS seed 81414, Greenroom job `993fda2d72a7`.
- `04-identity-hybrid-trellis-81422.glb`: FLUX identity-hybrid source seed
  81416, TRELLIS seed 81422, Greenroom job `7691b0e58bee`.

## Blender Assay

The first assay imported the four GLBs into a common Eevee scene and compared
them without mesh repair. The six durable views in
`eevee-comparison-2026-08-21/` establish that Eevee is already a useful final
comparison route for these casts. A later Cycles comparison may measure a
different rendering ceiling, but is not a prerequisite for the current static
visual-cast judgment.

For any repair pass, record whether each defect is:

1. a culling-only disappearance that renders acceptably two-sided;
2. an inverted-normal lighting or shadow defect that survives two-sided
   rendering;
3. an actual open hole, disconnected fragment, or self-intersection; or
4. a cosmetic low-poly or texture defect unrelated to winding.

Preserve the original imports. Any normal recalculation, hole filling, weld,
remesh, or material change belongs in a derived Blender file with the operation
named. A good static render can admit a bounded visual cast; it cannot establish
manifold topology, collision, normal-map baking, deformation, or production
geometry.

## Route Receipt

- Repo/worktree: `/private/tmp/kaminos-handy-candyman-skull-muzzle-0819`
- Branch: `cc/handy-candyman-crucible-shards-0713`
- Pre-shortlist HEAD: `56d0dd885cd1f0291ac5b639e09aac1cac07a517`
- Generation backend: native `trellis2mlx` through GPU Greenroom job type
  `trellis2mlx_fast_checkpoint`
- Generation controls: resolution 512, eight steps, no cascade, target 100000
  faces, texture 512, simplify-first, checkpoint preservation
- Viewer: Kaminos `window.kaminosImportGLBSceneObject` at
  `http://127.0.0.1:8104/`
- Operator smoke timestamp: 2026-08-21 approximately 17:56-17:59 EDT

`sources/` links the three exact FLUX inputs. `operator-smoke/` preserves two
raw close-orbit screenshots per selected cast. The feature-animation rear image
is the explicit gap witness. `eevee-comparison-2026-08-21/` preserves six raw
shared-scene comparisons and the revised rendering-route conclusion. Screenshot
SHA-256 hashes are recorded in each evidence directory.

Does not prove: consistent winding, closed manifold topology, collision,
deformation, normal-map bake correctness, arbitrary-light robustness,
production admission, or reference CUDA TRELLIS parity.
