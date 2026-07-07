# Kaminos Agent Notes

This repo follows the global Codex policy and local operator instructions. Local additions:

## Kiln / Crucible Vocabulary

Kaminos uses the kiln/crucible vocabulary for generated spatial, material, creature, terrain, motion, smoke-workbench, and world-cartridge work.

Use these implementation boundaries:

- **Spatial Asset Kiln:** subsystem/category for routes that turn sources into spatial, material, mesh, splat, image, motion, or world artifacts.
- **Kiln chamber:** visible place where spatial-asset and world-making routes are discovered, launched, inspected, and composed.
- **Bake Workbench:** operator-facing station or tool surface brought to bear inside a crucible for baking, material solving, route launching, comparison, and promotion.
- **Crucible:** persistent making-memory boundary for one source/intent loop. It owns armatures, handles, firings, shards, casts, receipts, notes, rejected directions, taste memory, and promotion history.
- **Armature:** durable control-bearing scaffold inside a crucible: source image, SAM isolation, mesh, splat, viewset, procedural field, Hill of Hills phase state, creature morphology generator, behavior scaffold, or specimen.
- **Handle:** selectable semantic region or affordance on an armature: mask, crop, aperture, shell band, material channel, normal/depth source, prompt/control parameter, body region, terrain region, or route knob.
- **Firing:** one transformation episode through inference, procedural generation, simulation, baking, reconstruction, rendering, or material solving.
- **Shard:** useful partial output or fragment.
- **Cast:** realized output from a firing that crossed into usable or promotable state.
- **Receipt:** route/config/evidence memory: actual route identity, backend/model, requested and effective config, source refs/hashes, output inventory, witnesses, visual smoke, failure phase, downgrade reason, and last trustworthy evidence.
- **Cartridge:** packaged live world or world module carrying runtime casts, editable crucibles, armatures, route recipes, receipts, behavior, shaders, terrain, creatures, smoke fixtures, and graduation modes.
- **Graduation:** promotion decision for a cast or crucible output: remain in Kaminos terrarium, enter a cartridge, port domain-native, extract shared runtime, ship a Kaminos-backed surface, export, or archive.

When building UI, tools, or sidecars, preserve these nouns in data structures and receipts. A visible panel can be a workbench; the durable substrate should still preserve crucibles, armatures, handles, firings, shards/casts, receipts, and graduation hooks.

## Generated Asset Smoke Links

Prefer root-relative Kaminos asset links for generated artifacts:

```text
index.html?mesh_root=greenroom&mesh_path=outputs/<dir>/output.glb
index.html?image_root=greenroom&image_path=outputs/<dir>/<image>.png
index.html?splat_root=greenroom&splat_path=outputs/<dir>/<splat>.ply
```

Keep absolute `glb_path` links as compatibility hatches. New route receipts should preserve requested/effective route identity, source root, relative path, output inventory, and witness identity.
