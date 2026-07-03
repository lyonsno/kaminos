# Kaminos

Kaminos is a browser-native WebGPU scene, material, and spatial asset kiln lab. It gives generated assets, route outputs, and world-state fragments a place to take shape with lineage, spatial context, and visible process.

The current prototype includes realtime volumetric fire and smoke running directly in the browser, corrected Gaussian splat asset handling, generated motion previews, and early world-embedded behavior experiments. Kaminos is not only a viewer for generated artifacts; it is becoming a place where those artifacts can be staged, inspected, corrected, promoted, and made to behave inside a world.

## Asset Kiln

Creative inference has an awkward rhythm: the operator forms a hypothesis about a generator, commits an experiment, then waits during the exact moment when curiosity is sharpest. Kaminos turns that wait into visible material transformation.

Route work should feel like an artifact entering a kiln. A source tile can preheat while inputs and backends prepare, burn while live compute spends, bank while outputs settle, cool once artifacts are linked, glow when cached work is recalled, and snuff when a route fails. The visual state carries the work: source artifacts, requested and effective routes, backend identity, output slots, failure phase, cache status, fixture status, and fallback status stay inspectable beside the flame.

This kiln language is a product target as well as an interface contract. Live compute earns full burn. Cached work earns residual warmth. Fixture and fallback routes carry weaker heat. Failure has its own collapse. The goal is a creative loop where inference latency has texture, route truth has a body, and every visible phase says something real about the work being done.

## Generated Motion Agency

Kaminos is also exploring generated motion as behavioral material for world-embedded actors. A generated motion clip can carry timing, attention, hesitation, compression, recoil, recovery, and commitment; Kaminos can decompose that source into cliplets and phrases, transpose it onto simple bodies, and let it interact with world context.

The early Motion panel work uses simple orb actors because they make agency legible before humanoid anatomy becomes a correctness trap. The goal is not to claim solved creature intelligence. The goal is to make generated or imported objects begin to notice, approach, avoid, inspect, recover, and return without looking broken.

See [Generated Motion Agency](docs/generated-motion-agency.md) for the current ontology and the next Path World steering target.

## World Chambers And Benches

The kiln is not only a status effect. Kaminos organizes spatial work into chambers and benches:

- **World Chambers** frame a coherent world, route, or generated space with its own identity.
- **Workbench/Kiln surfaces** are where artifacts are staged, conditioned, inspected, and promoted.
- **Preview Benches** are smoke surfaces for lane-owned payloads before they become part of a chamber or scene.
- **Smoke Offers** are the operator-facing handoff from a producing lane or station: "I have something you can smoke; here is the route, authority, freshness, downgrade state, and target bench."

This keeps the UI from collapsing into a pile of one-off tabs. A terrain route, splat correction, material bake, motion preview, or future world-state packet can all enter Kaminos with its own shape and lineage, then become inspectable in a shared spatial frame.

## Volumetric Fire

The landed fire volume is the first backend substrate for the kiln language. It already renders high-fidelity dancing flame and smoke in-browser through WebGPU, with pressure-tier controls that can spend more solver work in the visually important flame bands and less in background smoke.

The current fire volume is an internal prototype substrate. The roadmap turns it into scene-placeable primitives, route-activity adapters, transparent tile compositing, cached/fixture/fallback visual authority classes, banking/coals, failure snuff, and heat/color envelopes that can be driven by real Kaminos route lifecycle state.

## Asset Lineage

Kaminos keeps generated work inspectable after it leaves the model call. Corrected splat assets already follow this pattern: Kaminos stores editor-side correction sidecars beside original assets instead of mutating source splats. See [Splat Assets](docs/splat-assets.md).

## Local Smoke

Serve the checkout:

```sh
python3 serve.py 8095
```

Open the motion agency route:

```text
http://127.0.0.1:8095/?kaminos_motion_agency=1
```

Open the volume smoke route:

```text
http://127.0.0.1:8095/?kaminos_volume_smoke=1&volume_scene=tall_plume
```
