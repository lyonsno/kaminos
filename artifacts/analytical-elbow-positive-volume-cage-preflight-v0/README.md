# Analytical Elbow Positive-Volume Cage Preflight

This artifact records the fail-first contract predecessor for the
positive-volume cage assay. It contains no deformation map, optimization,
posed cage geometry, or visual mechanism result.

## Cases

- `row-s.json`: exact P0 sleeve manifest with one child-boundary node governed
  simultaneously by its `35`-degree rigid target and a rest-position sentinel.
  The preflight fails at `constraint-validation` with
  `constraint-conflict`, names both authorities and positions, and emits a null
  primary output. An adversarial replay with an invalid first cell proves that
  this conflict is adjudicated before cell geometry or orientation is evaluated.
- `asymmetric-non-ring.json`: one asymmetric tetrahedral cage and one immutable
  surface embedding using the same generic manifest, validation, semantic-hash,
  and report path without ring or axial indexing in the core API. It is admitted
  as API-shape evidence only.

The P0 sleeve fixture contains seven axial sections, eight circumferential
sectors, 63 nodes, 144 oriented tetrahedral cells, and 552 embedded transition
surface vertices. Ring and axial indexing exist only in the analytical-elbow
fixture builder.

The W-to-P0 predecessor exposed a missing preflight invariant: the original
polar interpolation weights summed to one but missed the exact rest surface by
as much as `0.022872586703842988` source units. The generic manifest now carries
source rest positions and rejects an embedding unless it reconstructs every
one within `1e-12`. Exact cross-section barycentric weights reduce the maximum
rest reconstruction error to `2.2929868617541516e-16`. Node and cell topology
are unchanged; source and embedding hashes changed with this correction.

Each durable CLI receipt records the requested and effective analytical-elbow
wrapper route alongside the requested and effective inner generic preflight
route. Both layers reject fallback.

## Replay

```sh
node analytical-elbow-positive-volume-cage-preflight.mjs \
  --case row-s \
  --output artifacts/analytical-elbow-positive-volume-cage-preflight-v0/row-s.json

node analytical-elbow-positive-volume-cage-preflight.mjs \
  --case asymmetric-non-ring \
  --output artifacts/analytical-elbow-positive-volume-cage-preflight-v0/asymmetric-non-ring.json
```

## Claim Ceiling

These receipts establish only that the generic preflight path can preserve
ordered cage, cell, source geometry, exact rest embedding, constraint,
configuration, and route identity; reject contradictory endpoint authority
before geometry; and admit one non-ring API fixture. They do not establish Row
W, W-to-cage admission, positive posed-cell orientation, solver behavior,
visual improvement, generated transfer, anatomy, Track M, production, or
product admission.
