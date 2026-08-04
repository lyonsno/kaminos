# Authored muscle coordinate export

`tools/export-authored-muscle-coordinates.mjs` turns a completed read-only Blender extraction, its deterministic Track M source graph, a reviewed routing fixture, and an exact ordered route request into two authority-bearing sidecars:

1. `kaminos.authored-muscle-coordinate-parent-atlas.v0`, which enumerates the complete source graph route inventory and binds every row into one atlas SHA-256;
2. `kaminos.authored-muscle-coordinate-authority-receipt.v0`, which preserves the exact caller order and classifies every Packer-required shared and per-route field as `admitted`, `candidate`, `missing`, or `conflict`.

The exporter emits `kaminos.authored-muscle-packing-coordinate-carrier.v0` only when every Packer-required field is admitted and no source/fixture binding conflict remains. Otherwise it emits a diagnostic `packer-authority-probe.json` marked `notAnAdmittedCoordinateCarrier`; that probe exists only to exercise Packer's refusal path and cannot be used as a packing source.

## Source measurements

The Blender extractor remains read-only. It now preserves native curve control/polyline samples, point radius/tilt metadata, mesh vertex positions, and raw mesh volume measurements alongside the pre-existing geometry hashes. Geometry hashes retain their previous payload definition, so adding forensic measurements does not silently change path or surface content identity.

Endpoint candidates are independently reconstructed from:

- origin/insertion helper world-matrix translations;
- first/last native path samples transformed into source-world coordinates;
- the centroid of the visible surface's extreme cap ring along the helper chord;
- the reviewed routing fixture endpoint when exact construction, lineage, instance, component, geometry, and asset identities agree.

Agreement does not create authority. A reviewed fixture candidate can admit an endpoint only when all named candidates agree within extraction precision. Disagreement remains a conflict with every candidate and locator preserved.

Native curve samples are uniformly resampled by arc length for the candidate centerline. The receipt records native samples, resampled samples, source path hash, arc length, and residual. Blender curve point radius is preserved but is not assumed to be physical muscle radius.

## Invocation

```sh
node tools/export-authored-muscle-coordinates.mjs \
  --extraction artifacts/authored-muscle-coordinate-export-v0/source-extraction.json \
  --source-graph artifacts/authored-muscle-coordinate-export-v0/source-graph.json \
  --routing-fixture fixtures/track-m-routing/m31-m47-routing-fixture.json \
  --requested-routes muscle-31,muscle-47 \
  --out-dir artifacts/authored-muscle-coordinate-export-v0/m31-m47 \
  --failure artifacts/authored-muscle-coordinate-export-v0/m31-m47.failure.json
```

Before writing primary sidecars, the CLI reads and hashes all inputs, verifies source extraction/graph identity, validates the exact ordered route request, and builds the parent plus receipt in memory. A failure before primary output writes `kaminos.authored-muscle-coordinate-export-failure.v0` with source identity when known, requested route ids, failure phase, error, and last trustworthy evidence.
