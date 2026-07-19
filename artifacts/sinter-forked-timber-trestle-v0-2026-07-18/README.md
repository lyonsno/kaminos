# Forked Timber Reliquary Trestle V0

Internal Kaminos asset package for an arbitrary-mesh combustion witness. The asset is an authored/generated GLB cast rather than an opaque reconstruction: the priority is an honest separable seam, named surface islands, finite indexed triangles, usable normals, object-local coordinates, and direct viewer registration.

## Promoted Files

- `promoted/forked-timber-reliquary-trestle-v0.glb` - visual GLB, 448 vertices, 864 triangles.
- `promoted/forked-timber-reliquary-trestle-v0-binding.glb` - lower-count binding GLB, 296 vertices, 560 triangles.
- `promoted/structuralMeshAssetDescriptor.json` - asset descriptor with bounds, hashes, coordinate frame, island names, and seam contract.
- `promoted/trestle-visual-front.png`, `promoted/trestle-visual-oblique.png`, `promoted/trestle-visual-side-seam.png` - inspected angle captures.

## Structural Contract

- Asset id: `forked-timber-reliquary-trestle-v0`.
- Coordinate frame: right-handed, `+Y` up, `+Z` forward, meters, transforms baked.
- Islands: `reliquary_trestle_body` and `sacrificial_crossbrace`.
- Authored seam: `support_loss_tenon_0` at `[0, 0.43, 0.30]`.
- Bounds: min `[-0.735876, -0.099055, -0.336918]`, max `[0.773458, 0.985997, 0.412754]`.
- Intended use: mesh-bound combustion witness where the crossbrace can be released without runtime triangle cutting.

## Smoke Routes

Visual GLB:

```text
http://127.0.0.1:8098/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-structural-bell-0718-handy-candyman-sinter-trestle-0718%2Fartifacts%2Fsinter-forked-timber-trestle-v0-2026-07-18%2Fvisual%2Fforked-timber-reliquary-trestle-v0.glb
```

Binding GLB:

```text
http://127.0.0.1:8098/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-structural-bell-0718-handy-candyman-sinter-trestle-0718%2Fartifacts%2Fsinter-forked-timber-trestle-v0-2026-07-18%2Fbinding%2Fforked-timber-reliquary-trestle-v0-binding.glb
```

## Evidence

- `witnesses/trestle-visual-direct.json` and `.png` prove the visual GLB route loaded through `/api/read`, preserved requested/effective route identity, and registered a GLB scene object.
- `witnesses/trestle-binding-direct.json` and `.png` prove the same for the binding GLB.
- `witnesses/trestle-visual-angle-witness.json` records front, oblique, and side-seam camera captures after route registration.
- `tests/sinter-trestle-asset-contracts.mjs` parses the GLBs directly and checks descriptor schema, named nodes, seam id, finite positions/normals, indexed triangles, counts, bounds, and hashes.

## Visual Verdict

The inspected visual GLB reads as a non-boxy forked timber support with an obvious front crossbrace and visible support-loss seam region across front, oblique, and side views. The asset is suitable as a browser witness carrier for surface binding and component release. It is not a photoreal hero prop, not collision-approved, not UV/PBR production quality, and not proof of runtime combustion behavior by itself.

## Useful Misses

- The first angle witness run failed before screenshot capture at `Runtime.evaluate`; the failure report was preserved and the witness script was patched to use the same WebGPU-friendly Chrome profile as the passing direct route witness.
- The route decision intentionally avoided SF3D/Trellis for this slice because topology honesty and separable named islands mattered more than image-conditioned photorealism.
