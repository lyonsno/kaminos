# Physical-Form Trellis Result

Recorded 2026-08-22 after direct inspection of front, left, right, and rear renders for all four casts.

## Fixed Assay

All four sources used Greenroom `trellis2mlx_fast_checkpoint` with native MLX TRELLIS, reconstruction seed 81431, 512 resolution, 8 steps, cascade disabled, 100000 target faces, 512 texture, simplify-first, and checkpoint preservation. Only the conditioning image changed. The effective routes in the Greenroom receipts include every requested reconstruction flag.

## Ranking

1. **Painted silicone markings, source 81435/04** - promoted as the best overall cast. The face retains the most natural identity of this set; both profiles preserve the muzzle, eye sockets, ear bowls, horns, and cheek planes; the rear is simplified but deliberately shaped rather than collapsed. Job `08d65b363bb6`, 181.0s, GLB SHA-256 `c6a6ae6755510ed265b97378849a58f85927b11e6886b556fdf4b18e083bc25a`.
2. **Rounded connected masses, source 81435/11** - promoted as the strongest topology-first alternate. It has the most explicit and complete rear construction, but the bulbous modular parts impose a large toy/plush identity tax. Job `abd909cdeaa2`, 171.7s, GLB SHA-256 `4d7891baac45fd4b10dde3d19560573192a48a84e2561a76b4c0b80e0fb621a1`.
3. **Connected planar facets, source 81434/09** - promoted as a constructed graphic alternate. The face and both profiles are strong, with legible planes and a complete muzzle; the rear resolves as a flatter shell and the lower termination is blunt. Job `4503b601d5b8`, 121.5s, GLB SHA-256 `feefa92cd35c2cf887990ac6c2afa90f44cf0dda8092bb970c55f33eddc47631`.
4. **Enamel smoothing diagnostic, source 81434/08** - preserve as a bounded-view cast. The front is polished and coherent, but the profiles and rear spend unseen geometry on a broad smooth bust envelope. Job `3db4cc38ee61`, 173.3s, GLB SHA-256 `3764d74a1c1947af52d3a45263f967dcfa7051a8c832c80949ed4b402d93f9e6`.

## Visual Evidence

Greenroom jobs `432e607d0839`, `92d770c6a723`, `c8a9f975b68c`, and `fb829e37574b` rendered the four successful view sets under `witness-repaired-v2/`. Effective renderer identity is Blender 5.1 EEVEE (`BLENDER_EEVEE` enum), 70 mm camera, two-sided materials, and no ambient-occlusion override. Each manifest records one mesh object, measured bounds, and exact source GLB.

The route reached trustworthy output only after exposing four failure classes: implementation cwd override before model load; repeated `-p` replacement dropping the witness script; Blender engine-enum drift; and a factory-startup scene with no world. Metadata-only renderer output was explicitly rejected as visual evidence. The final route produced sixteen nonzero PNGs and four manifests with no `failure.json`.

The four direct Kaminos routes were then exercised with the `mesh-asset-link` browser witness. Every route reported `status: loaded`, preserved requested root `lerms-preview`, resolved through its exact `/api/read` path, emitted a matching browser resource request, and registered the intended GLB as a reloadable scene object. Registration ids were `glb-edd964c3-86ea-4aea-a4ee-3924c81eaaad` (silicone), `glb-c70af16e-b003-40fb-b2df-1f0366d87777` (rounded masses), `glb-1ea9b2ad-938b-4d17-94c5-f7c7686ccdc6` (facets), and `glb-ad39a2d1-0d0b-4e8e-9b98-b134263cd69f` (enamel). The effective mount was `lerms-preview: /private/tmp`; the effective Kaminos server root was this worktree.

## Direct Routes

- Painted silicone: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-physical-form-controls-2026-08-21%2Ftrellis-controls%2F04-silicone-painted-markings-81435%2Ftrellis-81431%2Foutput.glb`
- Rounded masses: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-physical-form-controls-2026-08-21%2Ftrellis-controls%2F11-polystone-rounded-masses-81435%2Ftrellis-81431%2Foutput.glb`
- Connected facets: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-physical-form-controls-2026-08-21%2Ftrellis-controls%2F09-polystone-connected-facets-81434%2Ftrellis-81431%2Foutput.glb`
- Enamel diagnostic: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Fflux-physical-form-controls-2026-08-21%2Ftrellis-controls%2F08-polystone-enamel-eyes-81434%2Ftrellis-81431%2Foutput.glb`

## Claim Ceiling And Next Decision

These results support static whole-head visual coherence under two-sided EEVEE rendering and differentiated source-basin selection. They do not establish manifoldness, correct winding, collision fitness, riggability, production topology, arbitrary-light robustness, or CUDA parity.

The physical-form intervention is causal enough to keep exploiting: continue broader FLUX wording and seed exploration, prefer sources whose coat resolves into attached medium-scale parts, and use 8-step no-cascade TRELLIS probes on exact visually promoted cells. The prior 12-step cascade assay remains a negative cost/quality trade for this source family.
