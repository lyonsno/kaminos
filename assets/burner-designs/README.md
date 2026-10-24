# Kaminos burner design proposals

Three original, directly modeled assemblies, authored with Blender Python. These are visual design proposals for later flame/water work, not fabrication specifications. There is no simulation, collision implementation or application code in this asset pack. All materials are ordinary glTF metallic/roughness PBR; no external textures or downloaded geometry are required.

| Design | Construction | Proposed emission |
| --- | --- | --- |
| **CORONA — annular** | Bronze hollow manifold, removable slotted crown, polished inner/outer lips, three cast pedestals and rubber feet, rear hex union and teal handwheel | 24 radial capsule slots, each 68 × 14 mm, around a 275 mm radius; upwards. A 358 mm diameter central opening remains clear. |
| **RIFT — linear** | Dark finned plenum, teal end caps and saddles, two replaceable ivory ceramic lips, steel retainers, brass end feed | A continuous 880 × 16 mm rectangular ribbon aperture, upwards, at Y = 252 mm. |
| **VECTOR — directional** | Hollow converging steel barrel, copper mouth, rear cooling fins, teal trunnion yoke, orange open-spoke aim lock | One 118 mm diameter circular mouth, pointing along local +Z with 14° upward pitch. |

## Files

- `annular-burner.glb`, `linear-burner.glb`, `directional-nozzle.glb`: individual assemblies at ground origin.
- `burner-comparison.glb`: the exact three assemblies at the same metre scale, translated to X = −1.13, 0, +1.13 m. No floor, lights, cameras or annotations are in this GLB.
- `source/burner-designs.blend`: editable Blender scene, separate named components and bevel modifiers, with the comparison arrangement.
- `source/build_burners.py`: authoritative editable modeling source; geometry, materials, aperture descriptions and exports.
- `outlets.json`: complete proposed emitter attachment records, named mesh inventory and comparison translations.
- `source/inspect_exports.py`: reimports the actual GLBs, checks the proposed openings using inward rays, and creates studio previews. Floor/lights/camera exist only in this inspection scene.
- `previews/*.png`: rendered views of the exported GLBs, including top and bore inspection views.
- `previews/inspection.json`: actual import, part preservation, aperture clearance and export hashes.

## Coordinate and attachment convention

All GLBs and outlet JSON use **metres, right handed, +Y up, +X right, +Z forward**. Individual assembly roots are at ground level, under their respective main bodies. Positive X follows the linear burner; annular slots point +Y. The directional nozzle points mostly +Z with positive Y lift. JSON outlet positions/directions are relative to the individual assembly root, including when that root is a child of the comparison scene. Apply that root's world transform when placing sources in another scene. Directions are unit vectors; aperture dimensions are metres.

Each root has an `outlets_json` glTF extra. Each outlet also has a named empty node, `outlet_<id>`, with its own `outlet_json` extra. That node's **local +Y in the exported GLB** points out through the aperture; its local translation is the proposed emission surface centre. The sidecar is convenient for consumers that do not preserve arbitrary glTF extras. Aperture `major_axis`/`minor_axis` fields describe their dimensions in assembly coordinates; slots are real cuts into hollow interiors, not dark decals.

Blender itself uses Z-up. The exporter performs the standard rotation `(x, y, z)_Blender → (x, z, −y)_glTF`; the JSON writer applies the identical transform. The `.blend` is consequently Z-up while the delivered runtime contract is Y-up. Comparison translations are applied only after each individual GLB is exported.

## Regenerate

Tested with **Blender 5.1.2**. No Python packages beyond Blender's included modules are needed. From the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --threads 2 --python-exit-code 1 \
  --python assets/burner-designs/source/build_burners.py \
  -- --out assets/burner-designs
```

On another platform, replace the executable with `blender`. Edit `P` at the start of the source for the principal outlet settings, and the three modeling functions for construction/proportion revisions. Rebuilding replaces the four exports, Blender source scene and outlet sidecar. Output paths are caller selectable.

To validate the GLBs without rendering:

```sh
blender --background --factory-startup --threads 2 --python-exit-code 1 \
  --python assets/burner-designs/source/inspect_exports.py \
  -- --assets assets/burner-designs --no-render
```

Omit `--no-render` for six studio images. That route uses Cycles CPU, two threads, 24 samples and denoising. In this shared shop, submit rendering through Greenroom; the delivery receipt records its actual queue/route. The modeling script does not execute renders.

## Inspection scope

Clearance rays sample the centres and interior offsets of every proposed aperture for 50 mm inward clearance. This checks that actual exported openings lead into an interior; it is not a fluid/collision or manufacturing validation. The full exported GLBs are the visual review objects. Components have meaningful names such as `removable_port_crown`, `ceramic_lip_front`, `hollow_tapered_barrel` and `copper_outlet_lip`; fastener washers/heads and cooling fins remain separate too.

The first inspection exposed a broad lid gasket occluding the annular ports. It was replaced by inner and outer edge seals. Final exported apertures pass all 134 sampled clearance rays. Visual inspection also corrected the nameplate placement on the annular and linear designs.
