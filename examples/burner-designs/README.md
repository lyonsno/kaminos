# Burner geometry studies

Three reusable, unbound assets for choosing the physical apparatus before wiring flame sources. They use the existing Kaminos mesh viewer. They add no host, scene type, emitter law, collider registration or controls.

| Asset | Physical layout | Intended flame arrangement |
| --- | --- | --- |
| Crown | Annular cast body, perforated bronze head, twelve upward jet throats, open centre | Separate jets around a ring |
| Seam | Long cast plenum, removable parallel bronze lips and an open slot | A ribbon or line of sources |
| Lance | Angled nozzle, refractory liner and trunnion cradle | One directed jet |

These are visual design proposals, not manufactured burner specifications or validated combustion geometry. Dimensions are in metres. Each individual asset has its origin at the floor beneath the body and Y up. The export includes named opening nodes whose local +Y points out of the mouth. `designs.json` records their positions/directions in the individual asset frame, dimensions, aperture descriptions and file hashes. These are placement suggestions with no runtime binding. The comparison GLB arranges the same models side by side; its parent translations are presentation only.

Generate into a caller-owned directory:

```sh
node examples/burner-designs/generate.mjs /absolute/path/to/burner-assets
```

The output contains the three individual GLBs, `burner-studies.glb` and `designs.json`. Rerunning replaces those named outputs. No image generation, external textures or extra dependencies are needed. The source keeps the body, head/liner, hardware and opening nodes separate for later revisions or reuse as generation guides.

Mount that directory using `KAMINOS_GENERATED_MESH_DIR` on an existing Kaminos server, then open `/index.html?mesh_root=generated-meshes&mesh_path=burner-studies.glb`. Substitute an individual filename for a closer view. The normal fresh-asset viewer may rescale and ground an arrival; the metre dimensions in `designs.json` refer to the original GLB, before that editor placement.

Taste and physical layout are the current decision. Subsequent binding should consume existing authored objects/groups and source operations, after the shared-scene migration hold is released. No new assembly framework is implied by these assets.
