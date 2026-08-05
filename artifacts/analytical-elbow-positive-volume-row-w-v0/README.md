# Analytical Elbow Positive-Volume Row W

This artifact records the deterministic constructive-existence stage of the
positive-volume cage assay at the frozen `35`-degree pose. It is not a cage
projection or solver result.

## Result

`row-w.json` is classified `W_VALID`. The constructor uses a cubic Hermite
centerline with a transported cross-section field across the exact `0.72`
collar. The evaluator separately checks the source and route identities, rigid
boundaries, collar membership, transported-frame orientation, surface
orientation, self-intersection, cross-section area, and signed volume.

The recorded witness has:

- maximum rigid-boundary residual: `1.1102230246251565e-16`;
- minimum local tube Jacobian: `0.8438833506821933`;
- minimum posed surface-area ratio: `0.8093453518819234`;
- transition and global intersection counts: `0`;
- minimum cross-section area ratio: `0.9999999999999993`; and
- total signed-volume ratio: `0.9551642901775442`.

Two adversarial contract cases prove that a non-finite posed vertex and a
mutated parent-rigid vertex each change the classification to `W_INVALID`.

## Replay

```sh
node analytical-elbow-positive-volume-row-w.mjs \
  --output artifacts/analytical-elbow-positive-volume-row-w-v0/row-w.json
```

Two independent executions produced the same SHA-256 digest:
`b30f6eae7422ea71a2992595457731f6cfbf0e900e78dea13c5888760da31868`.

## Claim Ceiling

This receipt establishes that one recorded asymmetric map satisfies the frozen
Row W structural predicates on the synthetic sleeve. It does not establish
that P0 or P1 can represent the map, that an optimizer can discover or retain
it, that it improves the scalar collar visually, or that the mechanism
transfers to generated geometry.
