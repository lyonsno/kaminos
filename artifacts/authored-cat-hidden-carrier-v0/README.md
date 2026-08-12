# Authored Cat Hidden-Carrier Fixture V0

This first slice makes the operator-authored cat envelope executable as independent hidden-carrier truth. It does not yet claim a successful carrier-recovery method.

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

`hidden_carrier_assay.py` now wraps that fixture in a replayable CPU transaction. It:

- invalidates known primary artifacts before every execution and records the prior terminal-report digest;
- preserves requested and effective route, backend, profile, recovery arm, source locator/digest, and uniform-inset calibration authority;
- writes a nonterminal run-state receipt before source work;
- gives the recovery call only observed positions, observed normals, and one declared scalar inset;
- validates every primary artifact for presence, nonblank content, required arrays, cardinality, numeric type, finiteness, and digest;
- writes phase-local terminal failure reports with the last trustworthy evidence; and
- recomputes artifacts on rerun instead of accepting cached primaries.

The executable route is `cpu-numpy-authored-cat-hidden-carrier-v0` with backend identity `python-numpy-cpu`. It has no fallback route.

## Fail-first receipt

The initial seven tests failed on explicit `NotImplementedError` contracts. A later frame test then failed because the first medium-region implementation placed the patch toward `+Y`; the frozen export defines dorsal as `-Y`. After correcting the axis contract, all eight tests pass:

```text
python3 -m unittest artifacts/authored-cat-hidden-carrier-v0/test_hidden_carrier_fixture.py
........
Ran 8 tests
OK
```

The runner tests first failed on the explicit unimplemented transaction and then on each tightened evidence contract before implementation. After implementation, they cover exact successful identity, portable requested/effective locators, complete requested/effective route and calibration identity, missing and digest-mismatched sources, forbidden route/profile fallback, missing and blank primaries, partial recovery cardinality, both supported CLI output-directory forms and last-occurrence precedence, explicit rejection of long-option abbreviations, prior-run invalidation after early and implementation-identity failures, unremovable stale-primary behavior, deterministic artifact recomputation, implementation identity, and terminal-report preservation:

```text
python3 -m unittest artifacts/authored-cat-hidden-carrier-v0/test_hidden_carrier_assay.py
...............
Ran 15 tests
OK
```

Execute the source-bound medium-scapular negative control with:

```sh
python3 artifacts/authored-cat-hidden-carrier-v0/hidden_carrier_assay.py \
  --repo-root "$PWD" \
  --source artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb \
  --output-dir artifacts/authored-cat-hidden-carrier-v0/evidence/uniform-inset-medium-scapular-v0 \
  --profile short-with-medium-scapular-v0 \
  --uniform-inset 0.94
```

The `0.94` scalar is openly calibrated from the prior authored-truth depth summary and is recorded that way. It is a deliberately strong global constant control, not an inferred depth estimator.

## Composition boundary

The exact malformed-MLX carrier-recovery mechanism remains at Kaminos `12586e135c79682a7439aa6f0988788913049192`, `artifacts/mlx-malformed-coat-carrier-recovery-v0/`. This fixture must exercise that mechanism or an explicitly adapted equivalent before claiming composition. It must not copy the prior outer-carrier result and relabel it hidden-skin recovery.

## Claim ceiling and next slice

This slice establishes authenticated carrier loading, deterministic spatially varying synthetic coats, truth-isolated negative-control inputs, and falsifiable residual metrics. It does not establish silhouette recovery, volumetric recovery, VLM utility, arbitrary-source behavior, grooming, deformation, or visual admission.

The next mechanism slice adds observable strand/volume evidence and a spatially varying volumetric/SDF arm whose regional error can be compared against this uniform-inset control and the existing malformed-coat mechanism.
