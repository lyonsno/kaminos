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

The baked GLB writer preserves the target GLB and injects replacement PNG payloads for the PBR textures. It must not re-export the mesh through raw Trimesh, because that route dropped `NORMAL` attributes and changed material `doubleSided` state on the generated asset smoke. The manifest includes a post-export assay so closeouts can verify that UV0, normals, triangle count, and material records survived the bake.

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
