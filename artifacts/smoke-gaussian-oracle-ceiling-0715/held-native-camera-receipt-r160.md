# Held Native-Camera Smoke Oracle Receipt

Status: static native-camera representation evidence; temporal and production-compositor closure remain open.

## Source

- Viewer manifest: `/Users/noahlyons/.local/state/kaminos/volume-basins/operator-live-basin-0715/viewer-manifest.json`
- Manifest SHA-256: `553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa`
- Effective source route: `native-3d-compute-fluid-raymarch-v0`
- Backend: `WebGPU:apple`
- Grid: `160^3`
- Sim step: `179290`
- Admitted smoke voxels at explicit threshold zero: `4,058,593`
- Total admitted extinction: `1,858,452.360901263`
- Camera authority: matrices preserved from the checksum-bound held replay manifest.

## Reproducible Commands

```sh
node smoke-gaussian-oracle-fitter.mjs \
  --manifest /Users/noahlyons/.local/state/kaminos/volume-basins/operator-live-basin-0715/viewer-manifest.json \
  --manifest-sha256 553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa \
  --out-dir artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-fit-r160 \
  --budgets 32,64,128,256,512,1024 \
  --density-threshold 0 \
  --optimizer recursive-moment-split

node smoke-dense-raymarch-teacher.mjs \
  --fit-report artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-fit-r160/oracle-fit-report.json \
  --out-dir artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-teacher-r160-640x455 \
  --width 640 --height 455 --samples-per-cell 1

node smoke-gaussian-oracle-renderer.mjs \
  --fit-report artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-fit-r160/oracle-fit-report.json \
  --raymarch-png artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-teacher-r160-640x455/dense-raymarch-smoke.png \
  --out-dir artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-render-extended-r160-640x455 \
  --budgets 256,512,1024 \
  --extinction-scales 0.004,0.008,0.016 \
  --coverage-scales 1,1.25,1.5 \
  --projection native-camera
```

## Measured Frontier

| Active splats | Mass-weighted SSE | Support leakage | Native-camera luma MSE | Active-pixel IoU |
| ---: | ---: | ---: | ---: | ---: |
| 32 | 148255.2813 | 0.96875 | 0.000226939 | 0.92350 |
| 64 | 83780.0924 | 0.765625 | 0.000114335 | 0.95741 |
| 128 | 56175.6736 | 0.523438 | 0.000101157 | 0.90907 |
| 256 | 37007.4927 | 0.382813 | 0.000068600 | 0.93886 |
| 512 | 22610.6352 | 0.230469 | 0.000051219 | 0.95324 |
| 1024 | 14720.5470 | 0.130859 | 0.000043092 | 0.96346 |

All requested counts were effective counts. Relative extinction-accounting error remained between `1.03e-13` and `1.06e-13`.

The final in-report 1024-splat fit run charged `2,542.21 ms` to source validation and `14,397.24 ms` to optimizer plus product build (`16,939.46 ms` total CPU wall clock). A prior contended 256-splat run charged `44,438.17 ms`, while an external cold profile of the same 256 curve measured `8.04 s`; cost variance is therefore material and is not collapsed into a single flattering number. The `640x455` dense raymarch charged `33,254.89 ms`. Perspective proxy raster times in the broad sweep ranged from `715.73 ms` at 32 to `5,808.48 ms` at 256 across 50 extinction/coverage combinations, not per shipping frame.

## Visual Inspection

- `held-native-camera-teacher-r160-640x455/dense-raymarch-smoke.png`: inspected; compact mature smoke ceiling is nonblank, centered under the recorded camera, and contains soft vertical density structure.
- `held-native-camera-render-r160-640x455/perspective-render-contact-sheet.png`: inspected; 32 and 64 show strong horizontal partition bands, while 128 and 256 reduce but do not remove them.
- `held-native-camera-render-extended-r160-640x455/perspective-render-contact-sheet.png`: inspected; 512 and 1024 continue metric convergence and reduce band contrast, but visible partition topology remains at metric-selected coverage.
- `held-native-camera-coverage-1.5-r160-640x455/budget-1024.perspective-render.png`: inspected; `1.5x` covariance coverage largely collapses the horizontal bands while retaining substantially more internal structure than higher overlap.
- `held-native-camera-coverage-1.75-r160-640x455/budget-1024.perspective-render.png` and the `2x` counterpart: inspected; both further suppress bands but over-smooth the teacher structure, with MSE rising to `9.86e-5` and `1.37e-4` and IoU falling to `0.9041` and `0.8751`.

## Current Interpretation

The native-camera evidence does not support disqualifying Gaussian smoke. Count improves the fit monotonically, and moderate mass-preserving covariance dilation structurally mitigates the visible partition bands. The remaining static error is presently a fitter/coverage-selection wall, not proof of a Gaussian representation wall. Hostile camera and temporal continuation evidence are still required.
