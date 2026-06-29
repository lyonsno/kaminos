# Kaminos

Kaminos is a browser-native WebGPU scene, material, and spatial asset kiln lab. It treats generated assets, route outputs, and world-state evidence as specimens with source truth, route lineage, spatial context, and visible process.

The current prototype includes realtime volumetric fire and smoke running directly in the browser. The fire volume supports a tunable tall-plume scene, spatial pressure tiers, live route controls, debug overlays, and witness tooling that preserves backend identity, effective parameters, visual evidence, and route receipts. That fire is not decoration: it is the first substrate for making compute, cache, fixture, fallback, and failure states visible as different material phases.

The broader architecture is documented in [Spatial Asset Kiln](docs/spatial-asset-kiln.md). The short version: Kaminos is becoming a place where generated artifacts can enter World Chambers, sit on Workbench/Kiln surfaces, expose Preview Benches for source-honest smoke, and advertise Smoke Offers that an operator can open, inspect, capture, and route back as evidence.

## Asset Kiln

Creative inference has an awkward rhythm: the operator forms a hypothesis about a generator, commits an experiment, then waits during the exact moment when curiosity is sharpest. Kaminos turns that wait into visible material transformation.

Route work should feel like a specimen entering a kiln. A source tile can preheat while inputs and backends prepare, burn while live compute spends, bank while outputs settle, cool once artifacts are linked, glow when cached work is recalled, and snuff when a route fails. The visual state carries custody: source artifacts, requested and effective routes, backend identity, output slots, failure phase, cache status, fixture status, and fallback status stay inspectable beside the flame.

This kiln language is a product target as well as an interface contract. Live compute earns full burn. Cached work earns residual warmth. Fixture and fallback routes carry weaker heat. Failure has its own collapse. The goal is a creative loop where inference latency has texture, route truth has a body, and every visible phase says something real about the work being done.

## World Chambers And Benches

The kiln is not only a status effect. Kaminos organizes spatial work into chambers and benches:

- **World Chambers** hold a coherent world, route, or evidence space with its own source identity.
- **Workbench/Kiln surfaces** are where specimens are staged, conditioned, inspected, and promoted.
- **Preview Benches** are source-honest smoke surfaces: they can display lane-owned payloads, but they do not certify domain truth unless the source evidence does.
- **Smoke Offers** are the operator-facing handoff from a producing lane or station: "I have something you can smoke; here is the route, authority, freshness, downgrade state, and target bench."

This keeps the UI from collapsing into a pile of one-off tabs. A terrain route, splat correction, material bake, motion preview, or future world-state packet can all enter Kaminos with its own schema and provenance, then become inspectable without Kaminos pretending to own the source domain.

## Volumetric Fire

The landed fire volume is the first backend substrate for that kiln language. It already renders high-fidelity dancing flame and smoke in-browser through WebGPU, with pressure-tier controls that can spend more solver work in the visually important flame bands and less in background smoke.

The current fire volume is an internal prototype substrate. The roadmap turns it into scene-placeable primitives, route-activity adapters, transparent tile compositing, cached/fixture/fallback visual authority classes, banking/coals, failure snuff, and heat/color envelopes that can be driven by real Kaminos route lifecycle state.

## Source-Honest Evidence

Kaminos should make evidence easier to inspect without making it look stronger than it is. Witnesses and UI readouts preserve effective route identity, source authority, freshness, fallback/fixture/stale downgrades, accepted and rejected surfaces, and capture artifacts. Sidebar text alone is not acceptance evidence.

Corrected splat assets already follow this pattern: Kaminos stores editor-side correction sidecars beside original assets instead of mutating source splats. See [Splat Assets](docs/splat-assets.md).

## Local Smoke

Serve the checkout and open the volume smoke route:

```sh
python3 serve.py 8095
```

```text
http://127.0.0.1:8095/?kaminos_volume_smoke=1&volume_scene=tall_plume
```
