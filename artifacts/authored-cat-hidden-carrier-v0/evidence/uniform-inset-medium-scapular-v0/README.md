# Uniform-Inset Medium-Scapular Negative Control V0

This is the first durable numerical evidence transaction for the authored-cat hidden-carrier campaign. It is a negative control, not a successful recovery result.

## Bound identity

- Source: `artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb`
- Source SHA-256: `cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e`
- Source vertices: `3764`
- Profile: `short-with-medium-scapular-v0`
- Requested/effective route: `cpu-numpy-authored-cat-hidden-carrier-v0`
- Effective backend: `python-numpy-cpu`
- Recovery arm: `uniform-inset-negative-control-v0`
- Uniform inset: `0.94`
- Calibration authority: assay-author-selected from the prior authored-truth depth summary; this is not a solver-inferred depth.
- Terminal execution: `0aea5323-c5b0-459c-902e-78b9bef4805d`
- Terminal report SHA-256: `bd961f0801192f6bef2058a72c28460c1a5e84e518e56775233810e631c57697`
- Runner SHA-256: `e4c040fc98e0ff07c3246bff13e46ca745303ecddb6171f9dd22f964db155bcb`
- Fixture implementation SHA-256: `9e6b0f2a1773d716152dbc92c89e3e668fa4ec4fa39243a827ca72c1143e5509`

The terminal report records prior terminal digest `6dae2494ef1680bf320a71b2be80e21e16eacab91839d9c0e794810f743ff408`. That earlier local transaction was superseded after an unremovable stale-primary path exposed a pre-receipt false-closure risk. The terminal execution recomputed the primaries after the receipt-first invalidation repair; it did not accept the earlier files as cached evidence.

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
