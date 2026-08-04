# M31/M47 authored packing intake receipt

`m31-m47-intake-receipt.json` is the deterministic first receipt from the
packer-owned authored intake boundary. It consumes the exact checked routing
fixture and no coordinate carrier.

The result is intentionally non-admitted:
`identity-coherent_geometry-unavailable`. Authenticated source and muscle-route
identities plus byte-bound endpoints survived intake, but source-world
centerlines, parent-atlas derivation, target-volume authority,
skeletal-clearance primitives, and local compartment bounds were not present.
No packing source or packed geometry was manufactured.

Current receipt identities after the source-to-carrier conflict-status revision:

- file SHA-256: `b422a6482ab52c7af089d3424f3c13451c6f4402b030b41daee3ad7e6697f8c0`
- internal receipt SHA-256: `82f162cc8870eb79a2f8e8a9cb1cf972c466c39dbba1f113e685bcbd25d75ca4`

Reproduce from the repository root:

```sh
node tools/admit-authored-muscle-packing-intake.mjs \
  --routing-fixture fixtures/track-m-routing/m31-m47-routing-fixture.json \
  --receipt artifacts/authored-muscle-packing-intake-v0/m31-m47-intake-receipt.json
```

Exit code 2 is the expected result until a conforming coordinate carrier is
provided.
