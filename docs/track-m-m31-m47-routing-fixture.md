# Track M M31/M47 Routing Fixture

This fixture freezes Golden's selected `Cube.002 -> Cube.003` routing-sensitivity family from the operator-authored cat armature. It gives downstream Track M consumers one exact correct condition, one matched cross-wire condition, and two same-object controls without claiming that either rendered condition is better.

## Comparison

The correct condition retains the authored assignments for `Muscle 31` and `Muscle 47`. The matched-wrong condition swaps their insertion assignments while preserving:

- source asset, source graph, route-set, construction, instance, and lineage identity;
- both origin assignments and the complete attachment-endpoint inventory;
- path and surface geometry content identities;
- authored completeness, endpoint strategy, muscle settings, and route count; and
- every representational-budget count.

`Muscle 35` (`Cube.002 -> Cube.002`) and `Muscle 38` (`SRC_PELVIS -> SRC_PELVIS`) remain same-object nulls. They are controls carried by the fixture, not members of the cross-wire transform.

## Geometry Authority

The independent Blender assay supplies full-precision endpoint coordinates and authored chord measurements. The source graph supplies rounded endpoint transforms plus path and surface geometry identities. The compiler rejects stale endpoint registration, source or graph substitution, incomplete selected constructions, non-source-mesh endpoints, route-family drift, and changed geometry or budget.

The exported compiler accepts authenticated JSON bytes rather than already-parsed objects and derives both file hashes internally. Its matched-condition validator recomputes geometry, effective endpoint inventory, routing, and representational-budget receipts from each route body before comparing conditions. The CLI also treats its graph and assay paths as protected inputs: aliased destinations are rejected or redirected to a failure sidecar, and an input-read failure removes any safe stale primary output while leaving a durable phase-local receipt.

Centerline and surface coordinates are absent from both inputs. The emitted packing status is therefore `identity-coherent_geometry-unavailable`. This fixture can select and authenticate a routing perturbation; it cannot supply the coordinate-bearing geometry required by the anatomical packer.

## Invocation

```sh
node tools/compile-track-m-routing-fixture.mjs \
  --graph /path/to/cat-armature.source-graph.json \
  --assay /path/to/relation-geometry.json \
  --out /path/to/m31-m47-routing-fixture.json \
  --failure /path/to/failure.json \
  --expected-source-sha256 <blend-sha256> \
  --expected-graph-sha256 <graph-identity> \
  --expected-graph-file-sha256 <graph-file-sha256> \
  --expected-assay-file-sha256 <assay-file-sha256>
```

The checked-in fixture is `fixtures/track-m-routing/m31-m47-routing-fixture.json`. Its embedded `fixtureSha256` authenticates canonical semantic content; the JSON file itself has a separate byte hash because formatting and the embedded identity are different custody layers.

Focused verification:

```sh
node --test tests/track-m-source-projection-contracts.mjs tests/track-m-routing-fixture-contracts.mjs
```

## Claim Boundary

The admitted claim is `source-side-routing-sensitivity-fixture`. The fixture does not establish correct-route superiority, musculature source evidence, M0 passage, measurement station identity, source-to-cast correspondence, expected localization, tolerance acceptance, or packing-geometry admission. Those remain assigned to their named downstream owners.
