# Weathered Arch Stones

Native MLX TRELLIS preview assets, October 6, 2026. Source: Qwen-Image-2.1 images, TRELLIS2MLX preview (8 steps, no cascade, 512 grid, 100k target faces, 512 textures). Selected appearance set: rain-worn, bedded stone, aged masonry, quarry-split.

These files preserve the generated GLB bytes. Exact SHA-256s are in `../../structural-material-arch-stones.js` and checked during loading and tests.

Consumer route: `structural-material-arch-gpu.html?stones=1` now selects the bedded-stone 5k pilot: 4,943 triangles per body. `stoneDetail=10k` selects the 9,773-triangle pilot; `stoneDetail=original` retains the original four-variant set. The pilot meshes reuse the original frozen reconstruction/PBR checkpoints with new UVs and rebaked color/metallic/roughness textures. They do not carry a normal map. Original files remain unchanged.

The mesh is centered and fit once to each physical box envelope; its transform then follows the GPU body. Physical collision and connectivity remain box-based. Triangle hits supply the visible contact position; the nearest normalized box boundary supplies structural face ownership. This does not infer fracture structure from texture or enable fracture within one stone. Without `stones=1`, the existing box baseline remains available. Missing or mismatched assets and unknown detail levels fail visibly, without box fallback.
