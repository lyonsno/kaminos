# Burner assembly proposals

Three reusable visual assemblies for later connection to flame emitter tooling:

- `annular-haloforge.glb` — squat circular plenum with a true central opening and 24 upward-facing machined ports around it.
- `linear-ribbonrail.glb` — low rail housing with one long, continuous rounded slot cut through its ceramic deck.
- `directional-vectorlance.glb` — pivot-mounted hollow bell nozzle with a clearly aimed forward/upward outlet.
- `burner-assembly-comparison.glb` — the same three independent assemblies side by side, ordered annular, linear, directional.
- `outlets.json` — full local-coordinate aperture records for all openings, including each annular port.
- `comparison-preview.png` — inspected Kaminos asset-view capture of the side-by-side GLB.

## Coordinate convention

Dimensions use meters, matching the GLB convention of one unit per meter. Each standalone root is right-handed, with `+Y` up, `+Z` forward and `+X` to the right. Outlet directions are unit vectors in that root frame. The comparison file places the assemblies at annular `[-2.1, 0, 0]`, linear `[0, 0, 0]` and directional `[2.1, 0, 0]`; outlet records remain local to each named assembly root.

Outlet geometry is part of the model: annular ports are holes through the ring deck, the linear ribbon is a slot through the deck, and the nozzle is a hollow shell with an open mouth and throat. These proportions and materials are visual proposals, not fabrication specifications.

## Regenerate

From the repository root, run:

```sh
node tools/create-burner-assemblies.mjs
```

The script uses the repository's installed `three` package and `GLTFExporter`, writes editable geometry source and the five generated deliverables into `assets/burner-assemblies/`, and needs no external model or image input. Pass a different output directory as the first argument to generate a separate copy.
