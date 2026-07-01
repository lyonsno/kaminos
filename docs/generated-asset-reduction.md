# Generated Asset Reduction

Kaminos generated-asset reduction currently has two distinct routes that must not be conflated.

## Material-preserving reduction v1

`tools/generated-asset-lod.py` assays a source GLB and can emit glTF Transform reduction outputs that preserve the source glTF PBR material graph. The route is useful for immediate generated-asset handling because it preserves:

- UV0
- vertex normals
- source `baseColorTexture`
- source `metallicRoughnessTexture`
- explicit post-export assay evidence

It does not bake or synthesize:

- tangent-space normal maps
- ambient occlusion
- curvature/cavity masks
- emissive masks
- height/parallax maps

Those products stay marked `pending` or `deferred` in the manifest until an actual high-to-low projection path exists.

## Generated asset bake v0

`tools/generated-asset-bake.py` is the first high-to-low material transfer harness. It takes a detailed source GLB and a target GLB, requires both to already have `TEXCOORD_0`, rasterizes the target's existing UV0 atlas, reconstructs target surface positions per covered atlas pixel, projects those positions to the source material using the recorded route, and samples source UVs into new target-space textures.

V0 emits:

- `textures/baseColor.png`
- `textures/metallicRoughness.png`
- `debug/projectionDistance.png`
- `debug/projectionRoute.png`
- `debug/unresolvedMask.png`
- `debug/paddingMask.png`
- `asset-baked.glb`
- `generated-asset-bake-manifest.json`

The UV policy is deliberately narrow: `required-existing-uv0`. Trellis 2, Pixel 3D, and Stable Fast 3D generated meshes already emit UVs in the current pipeline, and SHARP splats are not an unwrap target. A mesh with no UV0 fails during preflight with a written manifest receipt. V0 does not spend engineering time on xatlas or other unwrap fallback paths.

The manifest records the effective projection route, nearest-surface candidate count when used, UV island padding radius, atlas coverage, projection distance statistics, emitted texture paths, and the failure phase/code when it cannot proceed. Atlas uncovered pixels are empty UV atlas space, not automatically object projection failures.

The baked GLB writer preserves the target GLB and injects replacement PNG payloads for the PBR textures. It must not re-export the mesh through raw Trimesh, because that route dropped `NORMAL` attributes and changed material `doubleSided` state on the generated asset smoke. Materialless target primitives receive the injected material, the injected material defaults `doubleSided: true`, and indexed target triangles are rewound to consistent shared-edge orientation before generated normals are appended. The manifest includes target-winding stats plus a post-export assay so closeouts can verify that UV0, normals, triangle count, and material records survived the bake.

The default V0.1 route is `nearest-source-surface`: a KDTree over source triangle centroids proposes nearby source triangles, the baker finds the closest point on those candidates, and source UVs are sampled barycentrically. The older `nearest-source-vertex` route remains available as a faster/cruder diagnostic path.

The normal-aware nearest-surface route (`nearest-source-surface-normal-aware`) additionally filters candidate source triangles by source/target normal agreement before falling back to the closest spatial candidate when no candidate passes. This targets thin-layer and opposite-side source-sheet pickup without treating the generated target as a globally clean watertight mesh.

V0.1 also dilates covered UV island pixels into nearby uncovered atlas pixels with `nearest-covered-atlas-pixel` padding. This targets the classic bake seam footgun where bilinear filtering or mipmapping pulls black/transparent atlas background into visible UV boundaries.

V0 still does not claim:

- tangent-space normal maps
- baked ambient occlusion
- curvature/cavity masks
- emissive masks
- height/parallax maps

Baked ambient occlusion is intentionally demoted rather than merely missing. Kaminos already pays for screen-space GTAO; baked AO risks double-occlusion and does not respond to nearby scene geometry. Normal baking is still a likely later target, but it should follow texture padding and projection-route cleanup.

## Generated asset bake LOD probe v0

`tools/generated-asset-bake-lod-probe.py` assays a high-detail source GLB and a set of candidate target GLBs, skips targets that violate the existing-UV0 contract, bakes the UV-bearing targets through `tools/generated-asset-bake.py`, and writes `generated-asset-bake-lod-probe-manifest.json`.

The probe records:

- target label and path
- actual triangle/vertex count
- UV0 and normal availability
- material texture availability and material flags
- source-relative geometry validity: bounds ratios plus voxel source-coverage
- bake route, texture size, padding, candidate count, and normal threshold
- bake command/result and emitted bake manifest
- direct Kaminos inspection URL for emitted baked GLBs

Use this route to answer whether baking buys a lower runtime topology path. If no lower target preserves UV0/normals, the next problem is target generation or UV-preserving decimation, not texture transfer. Arbitrary cube/sphere projection is a later hostility test, not the first runtime-LOD question.

The target validity assay is intentionally upstream of baking. It catches two
failure modes that looked like bake candidates in metrics but failed visually:

- `partial-bounds`: target bounds collapse relative to the source, as with a
  slab/side fragment that still has many triangles.
- `partial-coverage`: target bounds look plausible, but a voxelized source
  occupancy comparison shows that major source regions were deleted.

Non-assay runs skip those target-geometry failures before invoking the bake
route. A skipped lower target is not evidence against material transfer; it is
evidence that the candidate mesh is not a usable LOD substrate.

## 2026-06-29 molten cube smoke

Source:

`/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-trellis-hero-poly-probe-20260628T1007Z/nocascade8-face350k-tex4096/output.glb`

Output:

`/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-molten-asset-reduction-gltf-v1-20260629T1730Z`

Kaminos direct inspection route:

`/?glb_path=<absolute-glb-path>&glb_label=<label>`

This route loads the GLB through the guarded `/api/local-artifact` endpoint and
the normal GLB inspector path, so generated-asset closeouts can give the
operator a click-through Kaminos URL instead of a raw file path.

Observed result:

- Source: `328,987` triangles, `45.7 MB`, 4K source textures.
- Emitted 2K texture route: about `17.3 MB`.
- Requested `100k`, `40k`, and `15k` triangle targets all hit a hostile-topology floor around `110k` triangles.
- Post-export assay preserved UV0, vertex normals, base color texture, and metallic/roughness texture.
- Witness images are materially better than geometry-only Trimesh/old LOD output, but they are not final game LOD evidence.

Interpretation:

The glTF Transform route is a valid material-preserving compression and honest assay path. It is not yet a true 40k/15k runtime LOD path for Trellis cube-like assets. The next runtime-quality reduction step needs a real high-to-low bake path or a segmentation/component route that changes topology before decimation.

## Dead route: raw Trimesh simplification

Direct Trimesh simplification hit lower face counts but stripped UVs, normals, materials, and textures on this asset. Treat it as geometry-debug only unless a future route proves material preservation through post-export assay and visual witness.

## 2026-06-30 raw decimation + xatlas bake route

The first credible sub-110k target for the molten cube came from raw geometry reduction followed by a fresh xatlas unwrap, not from glTF Transform `simplify`.

Target:

`/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-raw43k-unwrap-bake-smoke-20260630Troute/raw43k-unwrapped.glb`

Fixed baked output:

`/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-raw43k-unwrap-bake-smoke-20260630Tmaterial-bound-normals/raw43k-unwrapped/asset-baked.glb`

Manifest:

`/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-raw43k-unwrap-bake-smoke-20260630Tmaterial-bound-normals/generated-asset-bake-lod-probe-manifest.json`

Kaminos inspection URL:

`http://127.0.0.1:18138/?glb_path=%2FUsers%2Fnoahlyons%2F.local%2Fstate%2Fgpu-greenroom%2Foutputs%2Fkaminos-generated-asset-raw43k-unwrap-bake-smoke-20260630Tmaterial-bound-normals%2Fraw43k-unwrapped%2Fasset-baked.glb&glb_label=raw43k-unwrap-baked-material-bound-normals`

Observed result:

- Target geometry: `43,671` triangles, `50,254` vertices.
- Validity gate: `reference-like`; dilated source voxel coverage `0.990072`.
- Bake route: nearest source surface, 512 texture, 12px padding.
- Bake duration in current smoke: about `28s`.
- Output GLB now binds the injected baked material to materialless target primitives and injects computed vertex normals when absent.
- Direct GLB visual witness passed and wrote:
  - `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-raw43k-unwrap-bake-smoke-20260630Tmaterial-bound-normals/direct-glb-witness.json`
  - `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-raw43k-unwrap-bake-smoke-20260630Tmaterial-bound-normals/direct-glb-witness.png`

Interpretation:

This route proves a lower-poly, whole-object, UV-bearing target can receive baked PBR textures and load through Kaminos' direct GLB route. It does not yet prove acceptable visual LOD quality. The current screenshot remains dark and shredded-looking after material binding and normals, so the remaining blocker is likely target geometry/projection/material-content quality rather than basic GLB export validity.

2026-07-01 winding-repair follow-up:

- Repaired output: `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-raw43k-unwrap-bake-smoke-20260701Twinding-repair/raw43k-unwrapped/asset-baked.glb`
- Manifest: `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-raw43k-unwrap-bake-smoke-20260701Twinding-repair/generated-asset-bake-lod-probe-manifest.json`
- Direct witness:
  - `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-raw43k-unwrap-bake-smoke-20260701Twinding-repair/direct-glb-witness.json`
  - `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-raw43k-unwrap-bake-smoke-20260701Twinding-repair/direct-glb-witness.png`
- Target winding repair flipped `103 / 43,671` faces (`0.0023585` ratio), with `9,677` components, `37,674` boundary edges, `36` non-manifold edges, and `42` conflict edges.
- Visual witness remained materially similar to the material-bound/normals smoke: the correction is real GLB hygiene, but it is not the visual fix for the raw43k target. Keep the next investigation pointed at target topology quality, projection/material pickup, or component/segmentation routes rather than blaming the whole screenshot on mixed winding.

2026-07-01 clay/front/back/normal geometry discriminator:

- Witness manifest:
  `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-geometry-witness-20260701Tsource-winding/generated-asset-geometry-witness-manifest.json`
- Contact sheet:
  `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-geometry-witness-20260701Tsource-winding/generated-asset-geometry-contact-sheet.png`
- Report:
  `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-geometry-witness-20260701Tsource-winding/generated-asset-geometry-witness-report.json`
- Topology assay:
  `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-geometry-witness-20260701Tsource-winding/generated-asset-topology-assay.json`

Earlier clay-only discriminator:

- Witness manifest:
  `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-clay-witness-20260701Tmolten-discriminator/generated-asset-clay-witness-manifest.json`
- Contact sheet:
  `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-clay-witness-20260701Tmolten-discriminator/generated-asset-clay-contact-sheet.png`
- Report:
  `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-generated-asset-clay-witness-20260701Tmolten-discriminator/generated-asset-clay-witness-report.json`

The geometry witness renders GLBs through the normal Kaminos direct-GLB route
with `glb_material=clay`, `clay-front`, `clay-back`, or `normal`, replacing
source textures/materials with a textureless diagnostic material and recording
`kaminosGeometryWitnessMaterialDebugState`. The contact sheet script sizes the
headless screenshot to include every asset/mode row; a partial viewport capture
is not acceptable evidence for multi-row matrices.

Inspected comparison:

- Source 350k Trellis GLB: distance-coherent, but not clean. Front-only and
  back-only modes both render substantial exterior/object structure, so the
  source itself carries mixed-winding/inside-out surface defects plus large
  open-boundary topology.
- glTF Transform floor output around 110k: visually close to the source under
  this view and carries the same general defect class; it does not produce a
  true 40k/15k runtime LOD.
- raw43k xatlas target before bake: shredded under clay before texture transfer.
- raw43k baked winding-repair output: materially the same shredded silhouette as
  the raw43k target under clay/front/back/normal diagnostics.

Topology assay summary:

- Source 350k: `328,987` faces, `254,045` boundary edges, `28` non-manifold
  edges, `113` same-direction shared edges, `196` winding-repair flips across
  `34,636` components.
- glTF 110k: `110,159` faces, `156,824` boundary edges, `122` non-manifold
  edges, `107` same-direction shared edges, `189` winding-repair flips across
  `27,555` components.
- raw43k xatlas: `43,671` faces, `37,674` boundary edges, `36` non-manifold
  edges, `64` same-direction shared edges, `103` winding-repair flips across
  `9,677` components.
- baked raw43k repaired: `43,671` faces, `37,674` boundary edges, `36`
  non-manifold edges, `18` same-direction shared edges, `0` additional
  winding-repair flips across `9,677` components.

Verdict:

The raw43k route's current visible failure is target topology amplification,
not a clean-source bake problem and not merely material binding, double-sided
rendering, generated normals, or local winding repair. The source already has
mixed winding and open surfaces, but raw43k concentrates the inherited defect
field into shredded structural sheets. Bake-time winding repair is still valid
GLB hygiene, but it cannot reconstruct missing or collapsed topology.
Projection/material debugging can wait until there is a lower target whose
textureless front/back/normal geometry reads coherently. The next reduction
route should be an intermediate topology ladder, component/segmentation route,
or different target-generation method rather than more bake tuning on this
raw43k mesh.
