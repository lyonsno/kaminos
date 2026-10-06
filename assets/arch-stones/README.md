# Weathered Arch Stones

Native MLX TRELLIS preview assets, October 6, 2026. Source: Qwen-Image-2.1 images, TRELLIS2MLX preview (8 steps, no cascade, 512 grid, 100k target faces, 512 textures). Selected appearance set: rain-worn, bedded stone, aged masonry, quarry-split.

These files preserve the generated GLB bytes. Exact SHA-256s are in `../../structural-material-arch-stones.js` and checked during loading and tests.

Consumer route: `structural-material-arch-gpu.html?stones=1` selects the operator-accepted `500-normal` bedded stone: exactly 500 triangles, embedded 1024px tangent normal texture and rebaked donor color. This version uses connected voxel-remeshed geometry, new UVs, metallic 0 and roughness 0.8. It does not preserve the original atlas or metallic/roughness maps. The loader retains its normal material on each body.

`stoneDetail=5k` selects the 4,943-triangle pilot, `stoneDetail=10k` the 9,773-triangle pilot, and `stoneDetail=original` the original four-variant set. The 5k/10k pilots reuse frozen reconstruction/PBR checkpoints with new UVs and rebaked color/metallic/roughness textures, without normal maps. Original files remain unchanged.

The mesh is centered and fit once to each physical box envelope; its transform then follows the GPU body. Physical collision and connectivity remain box-based. Triangle hits supply the visible contact position; the nearest normalized box boundary supplies structural face ownership. This does not infer fracture structure from texture or enable fracture within one stone. Without `stones=1`, the existing box baseline remains available. Missing or mismatched assets and unknown detail levels fail visibly, without box fallback.
