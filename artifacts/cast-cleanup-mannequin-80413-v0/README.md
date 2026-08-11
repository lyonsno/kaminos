# Mannequin 80413 Cast Cleanup Assay

This artifact family reconstructs the operator-selected middle mannequin cat into a temporary weight-paint carrier. The source is a visually coherent but topologically unusable fragment soup: 148,476 vertices, 127,143 triangles, and 24,032 connected components.

## Selected Output

`strong/cast.glb` is the selected carrier. It has 43,198 vertices, 86,392 triangles, one connected component, and SHA-256 `cf0bc10bde66d95926ac18c9a25aacb3e02d302b423a0369e2992a6d689070f8`.

Matched source and candidate renders show that this profile removes the fragment corrugation while preserving the ribcage and abdominal transition, scapular shelf, shoulder mass, pelvic and hindquarter volume, hock angle, paws, ears, and tail. The face is softened. The result has not yet been exercised under painted deformation.

`gentle` and `balanced` remain assay evidence, not viable carriers: both satisfy the one-component topology contract but retain plainly visible corrugation from the source fragments. Their rejection is visual, not inferred from counts.

## Route Evidence

The corrected Blender execution ran as GPU Greenroom job `462c28b41a11` with Blender `5.1.2`. `cleanup-spec.json`, `cleanup-report.json`, and `greenroom-receipt.json` bind the requested source, effective worker, profile parameters, output hashes, and matched renders.

Kaminos loaded and registered the exact selected GLB through:

`http://127.0.0.1:8101/?mesh_root=scratch&mesh_path=cat-cast-mannequin-80413-clean-strong-mounted.glb`

The server-owned scratch mount is an ephemeral copy of `strong/cast.glb`. `selected/kaminos-smoke-mounted-report.json` records the requested and effective route, declared server root, object registration, and browser resource. `selected/kaminos-smoke-mounted.png` is the inspected consumer frame.

The preceding symlink mount was correctly rejected with HTTP 403 because it escaped the declared scratch root. Its failed witness remains in `selected/kaminos-smoke-report.json` so the successful copy mount cannot erase the route failure.

## Rejected Execution

Greenroom job `acf6ff7776b1` accidentally admitted Blender's factory-startup cube into the imported source. Independent source counts exposed the exact `+8` vertices and `+12` triangles. Compact evidence is preserved under `diagnosis/default-cube-acf6ff7776b1/`; the full rejected family remains outside the worktree at `/private/tmp/cast-cleanup-mannequin-80413-rejected-default-cube-acf6ff7776b1`.

## Claim Ceiling

This is a clean temporary deformation carrier for weight-paint and motion assays. It is not anatomical, muscular, authored-production, or final cast truth.
