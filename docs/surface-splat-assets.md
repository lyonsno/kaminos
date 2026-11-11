# Deferred surface splat assets

Surface splats reconstruct color, normals, metallic, roughness and opacity before physical lighting. They can be stored in a GLB and loaded as an ordinary mesh asset, so scene placement, duplication, undo/redo and scene save/reopen use the existing authoring path.

Package a fitted field with an explicit triangle proxy:

```sh
node tools/package-surface-splats.mjs proxy.glb field-directory output.glb
```

The field directory contains a successful `report.json`, `surfels.f32` (12 floats per sample), fitted footprints (8 floats per sample), and per-sample depth tolerances when adaptive. The command verifies the field hashes, preserves the supplied GLB's geometry and materials, and writes `output.glb.report.json` on success or failure. The proxy currently needs one mesh node. The embedding function accepts an explicit mesh-node index for a larger GLB.

`KAMINOS_surface_splats` version 1 is a node extension. Its `data`, `footprints` and optional `depthTolerance` properties index embedded buffer views; `count`, `sourceCount`, `radius`, optional `adaptive` metadata and `optics` describe their interpretation. Data and footprints are little-endian float32 arrays in that node's local coordinate frame. Optics default to glass mode, IOR 1.45 and travel distance 0.06 in local scene units. The extension is optional: standard glTF viewers retain the supplied mesh fallback.

Kaminos replaces that node's beauty rendering with deferred splats and retains its triangles for picking, grounding, fluid solids, ash collisions and flame shadow capture. These consumers use the supplied proxy's fidelity; a good visual field does not repair an inaccurate physical proxy. Ordinary mesh LOD tiers may serve the proxy consumers but cannot silently replace splat beauty. The inspector edits visible triangle-body materials; fitted splat materials stay with their source field, and hidden fallback materials are not editable slots. A visual-only hybrid body uses `kaminosNonSolidVisual` so repetition and export retain it while solid consumers use the dedicated proxy. The loader normalizes the older paired-body `kaminosBeautyLodProxy` marker at import. Clones own independent reconstruction targets. Removing the asset releases those targets through the ordinary scene disposal path.

This carrier supports rigid geometry. It does not yet bind the visible field to skinned animation, vertex warps, combustion erosion or fracture. Glass samples the opaque scene through screen-space refraction; other glass layers and offscreen content remain outside that optical model. Scene save/reopen retains the source asset. The ordinary GLB exporter exports triangle geometry; it does not re-encode the fitted field.

The raw-field hybrid writer also exports `_KAMINOS_MATERIAL`, a two-component vertex attribute containing metallic and roughness. Its constant white base-color texture lets it share the UV accessor without adding vertices or another buffer. The loader installs interpolated physical material nodes; other glTF viewers use the material's mean metallic/roughness fallback.

Validation: `tests/surface-splat-{object,glb,shadows,scene-verdict}.mjs`, `tests/surface-field-material.mjs`, and `tests/hybrid-surface-partition.py`. `tools/surface-splat-scene-witness.mjs ORIGIN OUT [MATERIAL_FIXTURE_URL]` executes the production GLB loader, SSGI, solid raster and ash adapters on native WebGPU. `tools/surface-splat-authoring-witness.mjs ORIGIN OUT ASSET_URL` exercises an ordinary asset's placement, history and fresh scene reopening. Both browser commands require `CHROME_EXECUTABLE` and `PLAYWRIGHT_MODULE`, retain reports and close their own isolated browser.
