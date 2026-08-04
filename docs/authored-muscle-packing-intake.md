# Authored muscle packing intake v0

This boundary admits authenticated authored muscle geometry into the generic 3D
compartment packer without treating routing identity as geometry. It consumes a
Track M routing fixture and a separate byte-bound coordinate carrier, produces a
receipt on every terminal path, and emits a
`kaminos.muscle-compartment-packing-source.v0` object only after both inputs
agree.

The current M31/M47 fixture is deliberately not admitted. Its construction,
lineage, instance, component, geometry-hash, and fixed-endpoint identities are
accepted, while its own ledger says that centerline and surface coordinates are
unavailable. The checked receipt therefore reports
`identity-coherent_geometry-unavailable` rather than inventing a carrier.

## Coordinate carrier schema

`kaminos.authored-muscle-packing-coordinate-carrier.v0` has these required
fields:

| Field | Contract |
| --- | --- |
| `id` | Stable carrier identity used as the effective packer source id. |
| `derivation` | `{kind:"atlas-route-subset", atlas:{id,sha256}, selectedConstructionIds, selectionAuthority}`. The byte-bound parent atlas identity is mandatory, and the ordered selected ids must exactly equal the routing fixture's correct-route set. |
| `source.assetSha256` | Exact frozen `.blend` SHA-256 from the routing fixture. |
| `source.graphSha256` | Canonical authored source graph identity. |
| `source.graphFileSha256` | Effective serialized source-graph byte identity. |
| `source.routingFixtureSha256` | Routing fixture's internal payload identity. |
| `coordinateSpace` | `{kind:"source-world", dimension:3, unit:<nonempty>}`. No local/helper coordinates are admitted. |
| `compartment` | Solver box: id, ordered minimum/maximum points, and nonnegative clearance. |
| `obstacles` | At least one skeletal clearance primitive with a nonempty source authority. The v0 solver accepts capsules and spheres with positive radius and nonnegative clearance. |
| `muscles[]` | The exact fixture route set, from two through eight routes. A first operator-authored packing smoke still requires four through eight. |

Each muscle must preserve the fixture's `constructionId`, `lineageId`,
`instanceId`, `surfaceInstanceId`, `surfaceGeometrySha256`, `pathInstanceId`,
and `pathGeometrySha256`. Its origin and insertion ids, authorities, and
world-space positions must exactly equal the fixture's byte-bound assigned
endpoints. The carrier adds:

- a common resampled centerline knot count of at least four, with finite
  world-space positions and positive radii;
- exact endpoint equality between the centerline and the fixed attachments;
- a positive `targetVolume` and nonempty `volumeAuthority`;
- compartment and skeletal-clearance geometry sufficient for the packer's
  continuous clearance validator.

The carrier does not grant anatomical admission. Successful intake is marked
`operator-authored` and `geometric-only`; semantic correspondence and operator
visual/anatomical admission remain separate consumer gates.

### Candidate-first selection authority

The parent atlas may be incremental. Rows not selected by the current routing
fixture may remain `candidate`, `missing`, `conflict`, or `excluded` without
blocking an authority-complete selected subset. The carrier must bind the exact
selection decision under `derivation.selectionAuthority`:

```json
{
  "receipt": {"id": "<nonempty>", "sha256": "<receipt SHA-256>"},
  "sharedFields": {
    "coordinateSpace.unit": "admitted",
    "compartment": "admitted",
    "obstacles": "admitted"
  },
  "rows": [{
    "constructionId": "<exact ordered selected id>",
    "state": "admitted",
    "requiredFields": {
      "attachments.origin.position": "admitted",
      "attachments.insertion.position": "admitted",
      "centerline": "admitted",
      "targetVolume": "admitted",
      "volumeAuthority": "admitted"
    }
  }]
}
```

The row order must exactly equal `selectedConstructionIds` and the routing
fixture. Every listed state must be `admitted`; a `candidate`, `missing`,
`conflict`, or `excluded` state remains useful receipt evidence but cannot
produce a packing source. The intake returns `authority-incomplete` for that
case and preserves the non-admitted field paths in `missingFields`. A malformed
or reordered selected-row identity remains `source-identity-mismatch`.

## Reusable atlas subset contract

The coordinate producer emits one byte-bound source-wide parent manifest and
derives fixture-specific carrier files from it. Full geometry population may
accumulate incrementally. The intake does not consume or reinterpret the parent
manifest directly. It consumes a selected carrier whose `derivation`
preserves the parent atlas id and SHA-256 and whose ordered
`selectedConstructionIds` exactly match the routing fixture. This prevents a
carrier that omits atlas derivation from passing as one of its selected
subsets. The coordinate producer's byte-bound receipt remains responsible for
proving that the declared atlas SHA-256 names the emitted parent bytes; this
intake preserves and compares that identity but does not reopen the `.blend` or
recompute source-authoring truth.

No muscle name, cat-specific support object, M31/M47 id, or fixed route count is
part of the intake law. Deterministic contract coverage exercises non-M31/M47
subsets of two and four routes drawn in different orders from one six-route atlas.
Both subsets preserve fixed endpoints and pass the unchanged generic 3D packer.
The schema deltas required before exporter implementation hardens are the
explicit parent `derivation` provenance and the authority-complete selected-row
receipt above; geometry, identity, obstacle, compartment, and solver-source
values remain unchanged.

## Receipt statuses

| Status | Meaning |
| --- | --- |
| `admitted` | Identity, route, endpoint, carrier, volume, obstacle, and compartment contracts pass; `packingSource` is populated. |
| `identity-coherent_geometry-unavailable` | The routing fixture is authenticated, but there is no coordinate carrier. |
| `authority-incomplete` | A carrier or candidate receipt exists, but one or more selected rows or required solve fields is not authority-complete. |
| `input-identity-mismatch` | Requested and effective file identities disagree or name a different consumed input. |
| `source-identity-mismatch` | Carrier source or per-muscle identities disagree with the routing fixture. |
| `geometry-invalid` | Geometry exists but violates the coordinate/volume/clearance/solver-source contract. |
| `input-read-failed` | The CLI failed before admission and records the phase plus last trustworthy evidence. |

The CLI records requested/effective paths and effective file hashes. Exit code
zero means admitted, two means the expected identity-coherent geometry hold,
three means another admission rejection, and one means invocation, read, parse,
or receipt-write failure.

```sh
node tools/admit-authored-muscle-packing-intake.mjs \
  --routing-fixture fixtures/track-m-routing/m31-m47-routing-fixture.json \
  --receipt artifacts/authored-muscle-packing-intake-v0/m31-m47-intake-receipt.json
```

When the coordinate producer supplies the sidecar, add
`--coordinate-carrier <carrier.json>`. The `.blend` remains read-only; both the
carrier and deterministic packed output live outside it.

## Producer and consumer boundary

- The source compiler owns the authenticated construction, lineage, instance,
  relation, fixture, and source-graph identities consumed here.
- The coordinate producer owns the byte-bound world-space sidecar: endpoints,
  path/centerline samples, volume derivation authority, skeletal-clearance
  primitives, and the local compartment bounds needed for geometric admission.
- The semantic projection owns semantic selectors and source-to-carrier
  correspondence. Those claims are not synthesized by this intake.
- The packer owns this schema, identity comparison, geometric admission,
  packing execution, and residual-bearing witness.
- The joined Track M consumer should release the first authored
  four-to-eight-muscle cluster only after the coordinate, semantic, identity,
  and geometric receipts compose.
