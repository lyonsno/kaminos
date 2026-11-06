# CuMesh narrow-band remeshing

The browser original-remesh grid/topology, dual-contouring kernel and short-hole prefill adapt CuMesh's narrow-band remeshing and the Metal implementation carried by `pedronaugusto/mtlmesh`, as consumed by TRELLIS2MLX. The upstream CuMesh MIT copyright and permission notice are preserved verbatim in [LICENSE](LICENSE).

These adaptations are in `models/trellis2/original-remesh-grid.js`, `original-remesh-wgsl.js` and `original-remesh-prefill.js`. The source Python remesher used for comparison is `cumesh/metal_remeshing.py` (SHA-256 `c4a2619dc6978b1e7396bbd636b5203ad920cc580af2a2e3be841583eb83869b`).

Mesh reduction reuses the separately credited fast-simplification code in `../fast-simplification`. The existing Three MeshBVH supplies BVH construction; closest-surface traversal runs in the browser finisher's WGSL.
