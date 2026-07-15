# Held Hostile-Camera Smoke Oracle Receipt

Status: passed static held-out-view assay at the fixed `1024`-splat, `1.5x` covariance-coverage, `0.008` extinction-scale product. This is not temporal or production-compositor closure.

## Split Authority

- Source fit: `../held-native-camera-fit-r160/oracle-fit-report.json`
- Source fit manifest identity: `sha256:553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa`
- Camera split: `explicit-disjoint-world-space-hostile-camera-split-v0`
- Calibration camera: `recorded-native`
- Held-out cameras: `side-plus-90`, `back-plus-180`, `elevated-plus-35`
- Camera overlap: `0`
- Fit authority across cameras: `world-space-state-fit-camera-independent-v0`

Every derived camera product preserves the same dense-field, Gaussian-artifact, route, backend, and world-space identities. Only the camera matrices and their hashes change.

## Held-Out Metrics

| Camera | Camera identity | Dense raymarch ms | Luma MSE | Luma MAE | Active-pixel IoU |
| --- | --- | ---: | ---: | ---: | ---: |
| side-plus-90 | `sha256:c1487f3400bf6f699db81f75f2b538a2b8520915d35ce0a9ac77c5ef7a303e2d` | 27196.25 | 0.000091469 | 0.0021741 | 0.93608 |
| back-plus-180 | `sha256:f432bb7c8fdd485fe3129196c332da4b861a636869985a1946cc29bbd32721f9` | 15152.88 | 0.000102223 | 0.0023180 | 0.92879 |
| elevated-plus-35 | `sha256:b36ace032d72d2c6a173e235cf176fb717b7049fe109d0ee5617dfbc2d3bfbc4` | 146437.40 | 0.000066357 | 0.0018235 | 0.94683 |

All three views rendered exactly `1024` visible Gaussians with zero camera rejection. Render mean luma remained within `0.00127` of dense-teacher mean luma. The elevated teacher cost is a measured outlier and remains explicitly charged.

## Visual Inspection

- `side-plus-90/gaussian-1024-coverage-1.5/perspective-render-contact-sheet.png`: inspected. Silhouette, projected tilt, and broad mass agree. Gaussian output is smoother and retains faint horizontal partition texture.
- `back-plus-180/gaussian-1024-coverage-1.5/perspective-render-contact-sheet.png`: inspected. Back-view closure remains stable; no front-camera scenery collapse. Internal vertical striation is under-resolved.
- `elevated-plus-35/gaussian-1024-coverage-1.5/perspective-render-contact-sheet.png`: inspected. Elevated roof and side silhouette agree. Residual is concentrated on boundary shape and internal density detail, not blankness, gross depth fraud, or covariance explosion.

## Verdict Pressure

The held-out views reject the camera-facing-fog hypothesis for this static product. Current residual pressure is fitter/coverage selection and fine internal extinction structure. Gaussian representation remains viable at the tested static frontier; temporal continuation and production compositor behavior remain independent open walls.
