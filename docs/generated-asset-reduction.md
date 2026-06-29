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

## 2026-06-29 molten cube smoke

Source:

`/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-trellis-hero-poly-probe-20260628T1007Z/nocascade8-face350k-tex4096/output.glb`

Output:

`/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-molten-asset-reduction-gltf-v1-20260629T1730Z`

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
