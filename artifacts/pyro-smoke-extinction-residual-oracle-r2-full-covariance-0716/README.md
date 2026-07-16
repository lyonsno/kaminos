# Smoke Residual Oracle R2 - Full Covariance Isolation

R2 tests whether R1's discarded within-block cross-covariance/orientation materially causes its visible horizontal bands and missing asymmetric tongue. It changes no source, carrier, block assignment, centroid, mass, count, camera, or render calibration.

## Controlled Change

- Source: exact R160 simulation step 45, pre-absorption physical smoke body term.
- Control: frozen 1,024 broad Gaussians, unchanged product `sha256:831f322a870a3f690650815fb5d4b7c13b1673c82dbbac91c9167ad7439ad2ac` after `0.74` body scaling.
- Residual support: same 49,536 all-positive rigid 4x4x4 blocks as R1; sidecar remains `sha256:564efca0905957a8a44592309b7ce1618b14cfc486e658d92c6cd0f323b26b5a`.
- R1 geometry: residual-weighted centroid and diagonal residual-weighted variance, axis aligned.
- R2 geometry: same centroid and diagonal terms plus all residual-weighted cross moments, serialized full covariance, coherent Jacobi eigenbasis, and radii.
- Combined R2 product: `sha256:1a3cfc24f6c0f66e4a629ee6e7d026b9ca47f509a94e7b6e6ccd185021b404e0`; count 50,560; combined mass and `1.9295e-10` pre-serialization relative error are identical to R1.
- Witness calibration: extinction scale `0.2`, coverage `1`, inherited without retuning.

## Result

| Camera | R1 MSE | R2 MSE | R2 change | IoU change |
| --- | ---: | ---: | ---: | ---: |
| recorded native | `1.0479100e-6` | `1.0404400e-6` | `-0.71%` | `+0.00012` |
| elevated +35 held out | `2.8065386e-6` | `2.7985763e-6` | `-0.28%` | `-0.00003` |

The inspected R1/R2 panels are visually indistinguishable at both cameras. Full covariance does not remove horizontal bands, recover the lateral tongue, or introduce interior sheet topology. The tiny metric gain is not a qualitative representation advance, so side/back expansion and covariance tuning are not justified.

## Inspect

[`witness/contextual-comparison/index.html`](witness/contextual-comparison/index.html) describes every role and controlled variable. [`native-elevated-exposure8x.png`](witness/contextual-comparison/native-elevated-exposure8x.png), SHA-256 `1721450cf9fa0f614be8478729b52fad6bf104bd2d14e2aed52d8e06395f4d9a`, is the single-browser capture that was read back and inspected. The first three columns share display-only 8x exposure; column D is the renderer's target-error image.

## Disposition

Within-block orientation is not the live bottleneck on this basin. The next experiment must change continuity across rigid block boundaries: connected or overlapping residual support, with ridge-conditioned split/local sheets where one connected neighborhood contains multiple directions. It must retain exact per-voxel mass partition and no-cap accounting. No learned budget collapse or temporal witness is earned yet.
