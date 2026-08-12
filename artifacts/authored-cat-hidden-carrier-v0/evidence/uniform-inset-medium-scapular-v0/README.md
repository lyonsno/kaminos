# Uniform-Inset Medium-Scapular Negative Control V0

This is the first durable numerical evidence transaction for the authored-cat hidden-carrier campaign. It is a negative control, not a successful recovery result.

## Bound identity

- Source: `artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb`
- Source SHA-256: `cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e`
- Source vertices: `3764`
- Profile: `short-with-medium-scapular-v0`
- Requested/effective route: `cpu-numpy-authored-cat-hidden-carrier-v0`
- Requested/effective backend: `python-numpy-cpu`
- Recovery arm: `uniform-inset-negative-control-v0`
- Uniform inset: `0.94`
- Calibration authority: assay-author-selected from the prior authored-truth depth summary; this is not a solver-inferred depth.
- Terminal execution: `1b1f7e3c-f0a8-4b20-84a9-0f8a26a90571`
- Terminal report SHA-256: `961ee182de2e3899a6454280aef1a77cd65b0e901e2973a514d244a17f2b3c89`
- Runner SHA-256: `8be6f3ccb0c3b5f4e76aa8e6b1a0972dd2689932583f1a96059c6d9b781c6063`
- Fixture implementation SHA-256: `9e6b0f2a1773d716152dbc92c89e3e668fa4ec4fa39243a827ca72c1143e5509`

The terminal report records prior terminal digest `923b5c4b3f77234aa4e90eb78b5ef595be0769d3f46933f89b913a0e22460ced`. The terminal execution recomputed both primaries after long-option abbreviation was disabled explicitly; it did not accept the prior files as cached evidence. Requested repository-local paths remain stable public locators, and requested backend and inset-calibration identity remain explicit beside the effective values.

## Result

| Region or measure | Value |
| --- | ---: |
| Global RMSE | `0.2508719729407156` |
| Short-coat RMSE, 2790 vertices | `0.06608968394705113` |
| Medium-scapular RMSE, 974 vertices | `0.4803186225795486` |
| Mean error | `0.11461792981573254` |
| Maximum error | `1.408670790431266` |

The medium-scapular regional RMSE is about `7.27x` the short-coat RMSE. The global scalar therefore behaves as the intended control: it remains comparatively close on the short coat and fails strongly where coat depth varies.

## Artifacts and inspection

- `observation.npz`: SHA-256 `98aee3e9ca3a5a0c716c85b7c03d3849966d4134d6058fbf40155c92329bbf02`; finite `3764 x 3` observed positions and unit normals.
- `recovered-carrier.npz`: SHA-256 `0f8f3c07da545cb485215edabe43c5ab03300b10792de7ca84a08199dd4519e8`; finite `3764 x 3` recovered positions.
- `report.json`: requested/effective identity, source authority, artifact digests, regional metrics, truth-isolation declaration, prior-run receipt, and claim ceiling.
- `run-state.json`: terminal publication pointer and report digest.

Safety characterization: nonvisual numerical arrays and JSON only. This transaction generated no novel image, TRELLIS cast, infestation-like output, or operator-facing visual artifact.

## Interpretation and next predicate

This result establishes the comparison bar for the first spatially varying solver. A candidate volumetric/SDF arm must lower global and medium-scapular RMSE without materially degrading the short-coat region, using only declared observation evidence. This result does not establish volumetric recovery, arbitrary-source behavior, anatomical truth, groom reconstruction, deformation, or visual admission.
