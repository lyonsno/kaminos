# Kaminos

Kaminos is a browser-native WebGPU scene, material, and asset-kiln lab. It treats generated assets as specimens with source truth, route lineage, spatial evidence, and visible process.

The current prototype includes realtime volumetric fire and smoke running directly in the browser. The fire volume supports a tunable tall-plume scene, spatial pressure tiers, live route controls, debug overlays, and witness tooling that preserves backend identity, effective parameters, visual evidence, and route receipts.

## Asset Kiln

Creative inference has an awkward rhythm: the operator forms a hypothesis about a generator, commits an experiment, then waits during the exact moment when curiosity is sharpest. Kaminos turns that wait into visible material transformation.

Route work should feel like a specimen entering a kiln. A source tile can preheat while inputs and backends prepare, burn while live compute spends, bank while outputs settle, cool once artifacts are linked, glow when cached work is recalled, and snuff when a route fails. The visual state carries custody: source artifacts, requested and effective routes, backend identity, output slots, failure phase, cache status, fixture status, and fallback status stay inspectable beside the flame.

This kiln language is a product target as well as an interface contract. Live compute earns full burn. Cached work earns residual warmth. Fixture and fallback routes carry weaker heat. Failure has its own collapse. The goal is a creative loop where inference latency has texture, route truth has a body, and every visible phase says something real about the work being done.

## Volumetric Fire

The landed fire volume is the first backend substrate for that kiln language. It already renders high-fidelity dancing flame and smoke in-browser through WebGPU, with pressure-tier controls that can spend more solver work in the visually important flame bands and less in background smoke.

The current fire volume is an internal prototype substrate. The roadmap turns it into scene-placeable primitives, route-activity adapters, transparent tile compositing, cached/fixture/fallback visual authority classes, banking/coals, failure snuff, and heat/color envelopes that can be driven by real Kaminos route lifecycle state.

## Local Smoke

Serve the checkout and open the volume smoke route:

```sh
python3 serve.py 8095
```

```text
http://127.0.0.1:8095/?kaminos_volume_smoke=1&volume_scene=tall_plume
```
