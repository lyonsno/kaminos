# Kaminos

Kaminos is a browser-native WebGPU scene, material, and spatial asset kiln. It
treats generated assets as specimens with source truth, route lineage, spatial
evidence, visible process, and explicit promotion boundaries.

The product center is not a prompt box. Kaminos is a workbench where the
operator authors object law quickly, sends evidence through local or hosted
routes, watches route activity without losing custody, and folds useful results
back into the specimen.

## Spatial Asset Kiln

Creative inference has an awkward rhythm: the operator forms a hypothesis,
commits an experiment, then waits during the exact moment when curiosity is
sharpest. Kaminos turns that wait into visible material transformation.

Route work should feel like a specimen entering a kiln. A source tile can
preheat while inputs and backends prepare, burn while live compute spends, bank
while outputs settle, cool once artifacts are linked, glow when cached work is
recalled, and snuff when a route fails.

That language is not decoration. It is a route-truth contract. The visible heat
must preserve:

- source artifact identity;
- requested route and effective route;
- backend/runtime identity;
- fixture, fallback, request-only, live, partial, cached, failed, or promoted
  state;
- failure phase or timeout report;
- output slots and artifact roles;
- source-truth warnings;
- promotion status.

Live compute earns full burn. Cached work earns residual glow. Fixture,
request-only, and fallback routes carry weaker heat. Partial local outputs burn
unevenly and keep their custody warnings. Failure has its own collapse instead
of pretending to be a generated artifact.

## Specimen Conditioning Bench

The current bench contract is:

```text
one specimen gets smarter after a bad route pass
```

A specimen should move through:

```text
source evidence
-> truth layers
-> route request
-> route run
-> candidate, partial output, or failure report
-> operator failure tag or salvage decision
-> stronger next request
```

Fast truth belongs to the operator: geometry, masks, silhouette, depth, normal,
pointmap, region locks, scribbles, material swatches, collage references, and
negative law. Slow beauty belongs to route outputs: local WebGPU passes, hosted
generation, image-to-splat, mesh, material, or future scene-native routes.

The route tray and kiln activity should sit beside the specimen, not replace it.
The operator should be able to keep shaping while the kiln works.

## Current Evidence Surfaces

Current docs:

- [Specimen Conditioning Bench](docs/specimen-conditioning-bench.md)
- [Route Receipts and Source Truth](docs/route-receipts-and-source-truth.md)
- [WebGPU Truth-Layer Routes](docs/webgpu-truth-layer-routes.md)
- [Asset Kiln Fire Language](docs/asset-kiln-fire-language.md)
- [Splat Assets](docs/splat-assets.md)

Current implemented surfaces on this branch include:

- Composition Tray route/source/candidate evidence;
- Specimen Packet cockpit;
- graph `/api/run-pipeline` report ingestion;
- SHARP timeout/failure report custody;
- MoGE-shaped WebGPU depth/normal/pointmap truth-layer receipt binding;
- volume route substrate carried from earlier Kaminos work.

Current boundary: this branch binds MoGE WebGPU receipts and truth-layer packet
state, but it does not yet execute the live MoGE worker internally. The SHARP
smoke proved timeout/report custody, not successful splat generation.

## Volumetric Fire

Beaming's mainline volumetric fire work establishes the first backend substrate
for the kiln activity language: realtime browser WebGPU fire and smoke,
pressure-tier controls, route controls, debug overlays, and witness tooling
that preserves backend identity, effective parameters, visual evidence, and
route receipts.

The roadmap is to bind that fire substrate to route lifecycle state:

- source tile preheat;
- live compute burn;
- partial output ember;
- output settling bank/coals;
- cached glow;
- fallback/fixture weak heat;
- timeout smoke;
- failure snuff;
- promoted artifact cooled metal.

The fire volume should become a truthful status body for work in flight. It
must not become a decorative overlay that hides route identity or makes weak
evidence look stronger.

## Local Smoke

When the volume route exists in the checkout, serve Kaminos and open:

```sh
python3 serve.py 8095
```

```text
http://127.0.0.1:8095/?kaminos_volume_smoke=1&volume_scene=tall_plume
```
