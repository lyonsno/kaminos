# Matched TRELLIS Basin Probe Result

## Result

The six-cell assay completed. All six jobs produced nonblank GLBs, all six GLBs
loaded through `window.kaminosImportGLBSceneObject`, and all six registered as
active scene objects in the Kaminos single-asset viewer. Front and oblique
captures were visually inspected against each exact FLUX source.

The strongest result is `identity-hybrid-81416/trellis-81421`. It preserves the
best balance of source identity, readable eyes, muzzle volume, horn and ear
silhouette, cheek depth, and clean sculptural terminator. The second promotion
is `painted-maquette-81415/trellis-81421`, which carries the strongest stylized
character read and a coherent novel-view profile. `broad-planes-81416` validates
the low-frequency envelope hypothesis but yields a deliberately simpler cast.

## Matched Comparison

| FLUX source | TRELLIS seed | Job | Time | Visual disposition |
| --- | ---: | --- | ---: | --- |
| Identity hybrid 81416 | 81421 | `5dfac5a7b3a0` | 126.8 s | **Promote.** Best overall face, volume, silhouette, and oblique continuity. |
| Identity hybrid 81416 | 81422 | `7691b0e58bee` | 179.1 s | **Operator shortlist.** Coherent complete shell and strong oblique read; rougher bridge, eye region, and mouth than the matched 81421 winner. |
| Broad planes 81416 | 81421 | `273d03021f6f` | 112.2 s | Preserve as bounded cast. Clean low-frequency envelope with intentionally reduced surface richness. |
| Broad planes 81416 | 81422 | `6bbd9376009f` | 83.0 s | Useful miss. Coherent silhouette, rougher muzzle and less balanced facial assembly. |
| Painted maquette 81415 | 81421 | `bd13cc9108dd` | 110.9 s | **Promote.** Cleanest stylized character read and strong frontal/oblique survival. |
| Painted maquette 81415 | 81422 | `ddad82f0f4ae` | 184.7 s | Useful miss. Coherent shell but granular forehead/eye treatment; 8.8 MB GLB versus roughly 4.2-4.6 MB for the other cells. |

Matched seed variance is material. Seed 81421 wins all three source pairs, but
the operator's close-orbit review still promotes identity-hybrid 81422 into the
four-cast Blender shortlist. A single TRELLIS firing per source is therefore
not enough to characterize a source basin, even when every output is broadly
coherent.

## Route Identity

Requested route for every cell: Greenroom job type
`trellis2mlx_fast_checkpoint`, resolution 512, eight steps, no cascade, target
100000 faces, 512 texture, simplify-first, and checkpoint preservation.

Effective route for every cell: native
`/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py` with the
requested source, seed, `--resolution 512`, `--steps 8`, `--no-cascade`,
`--target-faces 100000`, `--texture-size 512`, `--simplify-first`, and
`--save-checkpoints`. Canonical receipts report exit 0 and no ignored
parameters. They carry `volatile_output`; this folder preserves the GLBs,
metadata, logs, requests, statuses, canonical receipts, and compact checkpoint
descriptors in branch custody. The six raw decoder checkpoint NPZ pairs remain
worktree-local because they total 362.5 MB and are not required to open,
compare, or render the casts; their canonical generated location is unchanged.

## Viewer Routes

- Identity hybrid 81421: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-basin-atlas-2026-08-21%2Ftrellis-probes%2Fidentity-hybrid-81416%2Ftrellis-81421%2Foutput.glb`
- Identity hybrid 81422: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-basin-atlas-2026-08-21%2Ftrellis-probes%2Fidentity-hybrid-81416%2Ftrellis-81422%2Foutput.glb`
- Broad planes 81421: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-basin-atlas-2026-08-21%2Ftrellis-probes%2Fbroad-planes-81416%2Ftrellis-81421%2Foutput.glb`
- Broad planes 81422: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-basin-atlas-2026-08-21%2Ftrellis-probes%2Fbroad-planes-81416%2Ftrellis-81422%2Foutput.glb`
- Painted maquette 81421: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-basin-atlas-2026-08-21%2Ftrellis-probes%2Fpainted-maquette-81415%2Ftrellis-81421%2Foutput.glb`
- Painted maquette 81422: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-basin-atlas-2026-08-21%2Ftrellis-probes%2Fpainted-maquette-81415%2Ftrellis-81422%2Foutput.glb`

Each cell's `witnesses/kaminos-witness.json` records the requested asset URL,
effective app URL, registration object, camera poses, capture inventory, and
claim boundary.

## Completion Delivery Gap

The six jobs completed correctly, but their submission requests carried no
executable completion callback. The artifact-local `completion_delivery`
declaration in `start-receipt.json` was a recovery statement, not a transmitted
callback. The job outputs were discovered by explicit status inspection. The
private completion-routing incident is preserved outside this repository.

## Claim Ceiling

These are orbitable visual casts with direct front/oblique viewer evidence.
The assay does not establish manifold topology, collision behavior, rigging,
animation suitability, production admission, or parity with reference CUDA
TRELLIS.
