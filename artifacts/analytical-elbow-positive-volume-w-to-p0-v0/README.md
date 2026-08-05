# Analytical Elbow Positive-Volume W-to-P0 Admission

This artifact records the deterministic representation bridge between the
reviewed Row W constructive witness and the smallest frozen P0 cage. It runs no
optimizer and claims no visual improvement.

## Result

`w-to-p0.json` is classified `W_P0_ADMITTED`. The admission evaluator first
revalidates the exact Row W predecessor and canonical P0 manifest. It then
replays the recorded Row W map at all 63 cage nodes, applies the immutable rest
embedding to 552 transition vertices, and evaluates every frozen hard
predicate on the resulting cage and complete sleeve surface.

The admitted state has:

- maximum source rest-reconstruction error:
  `2.2929868617541516e-16`;
- maximum rigid-boundary residual: `1.1102230246251565e-16`;
- maximum surface projection error against exact Row W:
  `0.0035276162169110593`;
- minimum signed tetrahedral volume ratio: `0.7882351622147697` across
  `144` cells;
- inverted or collapsed cells: `0`;
- inverted surface triangles: `0`;
- transition and global self-intersections: `0`;
- minimum cross-section area ratio: `0.9986394055421399`; and
- total signed-volume ratio: `0.9533628941254327`.

The result means P0 has enough representational capacity to encode one state
already known to satisfy Row W's geometry. A later optimizer failure from this
frozen initialization therefore belongs to objective, solver, line search, or
implementation behavior rather than fixed-extent geometric nonexistence or P0
capacity.

## Contract Correction

Before posed admission, a fail-first rest-reconstruction check found that the
preflight fixture's original polar interpolation missed the source surface by
up to `0.022872586703842988`. That was an embedding implementation defect, not
evidence against P0. The generic manifest now carries exact source rest
positions and rejects non-reconstructing embeddings. The fixture uses exact
barycentric cross-section weights; node and cell topology did not change.

## Replay

```sh
node analytical-elbow-positive-volume-w-to-p0.mjs \
  --output artifacts/analytical-elbow-positive-volume-w-to-p0-v0/w-to-p0.json
```

Two independent executions produced the same SHA-256 digest:
`82ab32f9fa5cde39f27e518edfd4efe051692f4becdda060fc74bbcf1529d52c`.

## Claim Ceiling

This receipt establishes only that canonical P0 can represent one exact
reviewed Row W state while satisfying the frozen hard predicates. It does not
establish that an optimizer can preserve or improve that state, that the result
looks better than the scalar control, that P1 is useful, or that the mechanism
transfers to generated geometry, anatomy, whole-object motion, production,
Track M, product, or box release.
