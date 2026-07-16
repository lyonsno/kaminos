# Smoke Residual Oracle R3 - Two-Phase Cross-Block Continuity

R3 tests whether R1/R2's rigid 4x4x4 ownership boundaries are the material cause of horizontal bands and missing asymmetric smoke topology. It adds a second complete block partition staggered by half a block in all axes and divides every positive voxel's residual mass equally across the two partitions.

## Controlled Change

- Source: exact R160 simulation step 45, pre-absorption physical smoke body term.
- Control: frozen 1,024 broad Gaussians, unchanged scaled product `sha256:831f322a870a3f690650815fb5d4b7c13b1673c82dbbac91c9167ad7439ad2ac`.
- R2 residual: one full-covariance Gaussian per positive rigid 4x4x4 block, 49,536 rows.
- R3 residual: complete `(0,0,0)` and `(2,2,2)` block partitions, full covariance, equal `0.5` membership weight per partition, 100,215 natural positive windows, no cap.
- Per-voxel residual membership range: exactly `[1,1]`; residual mass is neither omitted nor duplicated.
- R3 residual product: `sha256:0862003fca61509e8b15127721f18935394b7a93e38e656e315795bba6df0b62`.
- R3 combined product: 101,239 rows, `sha256:823e857e3f250307450db5bd1daf9a74fb5d0d37477910396ff3590b11b442e7`.
- Combined relative error before serialization: `1.9295241e-10`; serialized combined relative error: `3.8799737e-10`.
- Witness calibration: extinction scale `0.2`, coverage `1`, inherited without retuning.

## Result

| Camera | R2 MSE | R3 MSE | R3 change | IoU change |
| --- | ---: | ---: | ---: | ---: |
| recorded native | `1.0404400e-6` | `9.7136929e-7` | `-6.64%` | `+0.00322` |
| elevated +35 held out | `2.7985763e-6` | `2.7914911e-6` | `-0.25%` | `+0.00041` |

The inspected native panel shows slightly softer horizontal quantization, consistent with the metric gain. It does not recover the exact target's broad asymmetric tongue, cavities, or interior sheet breakup. Elevated +35 is visually unchanged. Cross-block overlap therefore addresses a secondary projection artifact, not the primary topology failure, and doubling residual count is not a viable production trade.

## Inspect

[`witness/contextual-comparison/index.html`](witness/contextual-comparison/index.html) anchors exact target, R1 rigid diagonal, R2 rigid full covariance, R3 two-phase overlap, and R3 target-error roles at both cameras. [`native-elevated-exposure8x.png`](witness/contextual-comparison/native-elevated-exposure8x.png), SHA-256 `a9b96772b2f5c489dc4e6ece5aeaf7e7a9235a54073ad540d859ee4c357cbfcd`, is the single-browser capture that was read back and inspected. The first four columns share display-only 8x exposure; column E is the renderer's target-error image.

## Disposition

Rigid block boundaries contribute some native projection error but are not the live smoke-topology bottleneck. Do not add more overlap phases or tune covariance. The next falsifier should spend a comparable diagnostic count on multiple locally coherent modes inside each neighborhood, using the already-derived ridge/gradient and principal structure to split mass into sheet-like support. It must retain exact per-voxel mass partition, explicit natural-count semantics, and the fixed native/elevated witness before any learner or temporal run.
