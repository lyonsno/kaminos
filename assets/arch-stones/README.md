# Weathered Arch Stones

Native MLX TRELLIS preview assets, October 6, 2026. Source: Qwen-Image-2.1 images, TRELLIS2MLX preview (8 steps, no cascade, 512 grid, 100k target faces, 512 textures). Selected appearance set: rain-worn, bedded stone, aged masonry, quarry-split.

These files preserve the generated GLB bytes. Exact SHA-256s are in `../../structural-material-arch-stones.js` and checked during loading and tests.

Consumer route: `structural-material-arch-gpu.html?stones=1`. The mesh is centered and fit once to each physical box envelope; its transform then follows the GPU body. Physical collision and connectivity remain box-based. Triangle hits supply the visible contact position; the nearest normalized box boundary supplies structural face ownership. This does not infer fracture structure from texture or enable fracture within one stone. Without `stones=1`, the existing box baseline remains available. Missing or mismatched assets fail visibly, without box fallback.
