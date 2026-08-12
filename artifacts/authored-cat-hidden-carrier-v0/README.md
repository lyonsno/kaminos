# Authored Cat Hidden-Carrier Fixture V0

This first Scrooge slice makes the operator-authored cat envelope executable as independent hidden-carrier truth. It does not yet claim a successful carrier-recovery method.

## Source authority

- Frozen carrier: `../registration-consumer-v0/inputs/authored_cat_envelope.glb`
- SHA-256: `cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e`
- Prior-work source: Kaminos `cc/golden-registration-consumer-0808@178f9155`
- Frame: medial/lateral `X`, anterior/posterior `Z`, dorsoventral `Y`, dorsal toward `-Y`

The GLB is the fixture's source authority. The nearby `latest-envelope-029.png` remains an authenticated conditioning plate but cannot supply 3D truth because its originating render invocation was not preserved.

## Implemented contract

`hidden_carrier_fixture.py` provides:

- digest-bound fixture metadata with an immutable repository locator;
- a dependency-light GLB v2 position/normal loader with world-transform handling;
- deterministic `short-v0` and `short-with-medium-scapular-v0` coat-depth fields;
- observation synthesis from carrier positions, surface normals, and authored depths;
- `uniform-inset-negative-control-v0`, whose signature cannot receive the per-vertex truth depths;
- global and region-local carrier residual metrics.

The uniform inset is intentionally a negative control. It is not the volumetric/SDF recovery promised by the campaign charter, and a favorable short-coat result cannot promote it into that role.

## Fail-first receipt

The initial seven tests failed on explicit `NotImplementedError` contracts. A later frame test then failed because the first medium-region implementation placed the patch toward `+Y`; the frozen export defines dorsal as `-Y`. After correcting the axis contract, all eight tests pass:

```text
python3 -m unittest artifacts/authored-cat-hidden-carrier-v0/test_hidden_carrier_fixture.py
........
Ran 8 tests
OK
```

## Composition boundary

The exact malformed-MLX carrier-recovery mechanism remains at Kaminos `12586e135c79682a7439aa6f0988788913049192`, `artifacts/mlx-malformed-coat-carrier-recovery-v0/`. This fixture must exercise that mechanism or an explicitly adapted equivalent before claiming composition. It must not copy the prior outer-carrier result and relabel it hidden-skin recovery.

## Claim ceiling and next slice

This slice establishes authenticated carrier loading, deterministic spatially varying synthetic coats, truth-isolated negative-control inputs, and falsifiable residual metrics. It does not establish silhouette recovery, volumetric recovery, VLM utility, arbitrary-source behavior, grooming, deformation, or visual admission.

The next slice is a durable CPU runner that records exact configuration and failure phase, produces the two coat observations and negative-control residuals, and then adds a volumetric/SDF arm whose regional error can be compared against the uniform-inset control and the existing malformed-coat mechanism.
