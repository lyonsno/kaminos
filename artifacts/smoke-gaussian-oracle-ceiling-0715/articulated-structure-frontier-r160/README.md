# Articulated Smoke Structure Frontier

Status: static Gaussian representation survives; the tested mature `160^3`
smoke state is budget-limited, with a visible and metric knee near 8192 active
splats. Direct extinction-only inference at 1024 is rejected as a viable route
to articulated closure because it improves the calibration projection while
regressing held-view pixel error.

## Authority

- Source manifest: `/Users/noahlyons/.local/state/kaminos/volume-basins/operator-live-basin-0715/viewer-manifest.json`
- Manifest SHA-256: `553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa`
- Effective source route: `native-3d-compute-fluid-raymarch-v0`
- Backend: `WebGPU:apple`
- Grid / sim step: `160^3` / `179290`
- Admitted smoke voxels: `4,058,593` at explicit threshold zero
- Total admitted extinction: `1,858,452.360901263`
- Camera split: calibration `recorded-native`; held-out `side-plus-90`,
  `back-plus-180`, and `elevated-plus-35`; overlap `0`
- Gaussian fit: `recursive-weighted-moment-split-v0`, all admitted voxels,
  freely positioned density-weighted centroids, full world-space anisotropic
  covariance, exact requested counts, and no hidden budget cap
- Render witness: full-covariance perspective projection through the exact
  recorded/derived camera matrices, fixed mass-preserving coverage `1.5`, fixed
  extinction scale `0.008`, and CPU optical-depth proxy compositing
- Downgrade: this is not the production smoke compositor and does not provide
  charged shipping-GPU raster/sort/composite cost.

## Fail-First Receipts

The boundary-aware allocation contract first failed because
`recursive-gradient-moment-split` was unsupported, then exposed centered-gradient
peak blindness and an illegal weighted-median split at the last coordinate.
The corrected fitter passes a richer eight-leaf fixture and records the exact
gradient-allocation authority.

The differentiable structural optimizer contract proves zero identity loss,
penalizes erased edges, passes a finite-difference derivative check, recovers a
known two-Gaussian target with more than 99% loss reduction, conserves total
extinction, rejects stale teacher camera identity, and writes a durable failure
report before primary-product failure. A final fail-first assertion rejected
pre-serialization extinction accounting (`5.999999999999999` versus the durable
Float32 product's `6`); reports now sum the serialized product bytes.

## Negative Formulations

### Boundary-weighted allocation

At 1024 splats, gradient allocation gains `1`, `4`, `16`, and `64` all remained
visually the same smooth carrier. Gain `1` made the best volumetric change,
reducing mass-weighted SSE only from `14720.5470` to `14667.8282`, while support
leakage worsened from `0.130859` to `0.137695`. Larger gains did not recover
shoulders, necking, coherent cavities, asymmetric boundary evolution, or cap
morphology. Boundary allocation alone is rejected.

### Direct 1024-splat extinction inference

A 120-iteration, uncapped log-mass Adam fit against the native teacher reduced
the multiscale value-plus-gradient objective from `9.2880540e-5` to
`6.7536455e-5` (`27.3%`) in `9782.59 ms`, while preserving serialized total
extinction to `8.50e-10` relative error. Native luma MSE improved from
`6.54991e-5` to `4.70556e-5`.

That gain did not generalize. Relative to the unchanged 1024 world-space
product, optimized MSE changed from `9.14687e-5` to `1.41435e-4` on side
(`+54.6%`), `1.02223e-4` to `1.04474e-4` on back (`+2.2%`), and `6.63573e-5`
to `8.26075e-5` elevated (`+24.5%`). IoU rose slightly on all views, showing
that calibration-view mass redistribution thickened support while corrupting
held optical values. Visual inspection confirms a smooth carrier and a bright
side-view top-edge residual, not restored mesostructure. Mass-only single-view
inference at 1024 is rejected as view-specific polish.

## Count Frontier

All counts are exact active counts. Native and held views use one fixed
coverage/extinction setting selected before the expanded sweep.

| Active splats | World SSE | Leakage | Native MSE / IoU | Side MSE / IoU | Back MSE / IoU | Elevated MSE / IoU |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1024 | 14720.5470 | 0.130859 | 6.54991e-5 / 0.93327 | 9.14687e-5 / 0.93608 | 1.02223e-4 / 0.92879 | 6.63573e-5 / 0.94683 |
| 2048 | 9591.3474 | 0.100098 | 4.18383e-5 / 0.95886 | 6.36968e-5 / 0.96046 | 7.81308e-5 / 0.95608 | 5.26351e-5 / 0.96359 |
| 4096 | 5877.8125 | 0.031982 | 3.36947e-5 / 0.96982 | 5.49947e-5 / 0.97142 | 7.04940e-5 / 0.96801 | 4.39620e-5 / 0.97270 |
| 8192 | 3730.9003 | 0.029541 | 2.81433e-5 / 0.98119 | 4.78472e-5 / 0.98410 | 6.35673e-5 / 0.97909 | 3.81822e-5 / 0.98332 |
| 16384 | 2379.2177 | 0.023376 | 2.49172e-5 / 0.98471 | 4.54875e-5 / 0.98498 | 6.00464e-5 / 0.98391 | 3.50907e-5 / 0.98925 |

The 1024-to-4096 move restores visible internal vertical density channels in
all four views and materially improves boundary agreement. The 4096-to-8192
move remains visible and improves held MSE by `9.8-13.2%`. The 8192-to-16384
move costs twice the active count for only `4.9%` side, `5.5%` back, `8.1%`
elevated, and `11.5%` native MSE improvement; its visual delta is subtle. The
first honest static knee is therefore approximately 8192 active splats for
this state and renderer.

## Measured Costs

- The `4096/8192/16384` recursive hierarchy plus all three durable products
  charged `186.38 ms` source validation and `14088.85 ms` optimizer/product
  build (`14275.23 ms` total CPU wall clock).
- One fixed-setting native CPU proxy render charged `78.75 ms` at 1024,
  `97.46 ms` at 2048, `124.99-125.69 ms` at 4096, `161.47 ms` at 8192, and
  `255.75 ms` at 16384. Elevated charged `176.11`, `216.80`, and `329.18 ms`
  at 4096/8192/16384.
- Mean projected contributors per native support pixel rose from `42.04` at
  1024 to `67.97` at 4096, `92.17` at 8192, and `116.02` at 16384; the maximum
  rose from `220` at 4096 to `334` at 16384. This is an explicit deep-overlap
  compositor pressure, not a free quality gain.
- The dense teacher and source capture remain WebGPU-authoritative, but the
  Gaussian raster numbers above are CPU oracle costs. Shipping GPU raster,
  sort, and composite charges remain unmeasured and must not be inferred from
  these CPU timings.

## Inspected Witnesses

- `../held-native-camera-render-budget-16384-r160-640x455/perspective-render-contact-sheet.png`
- `../held-hostile-camera-split-budget-16384-r160/side-plus-90/gaussian-coverage-1.5/perspective-render-contact-sheet.png`
- `../held-hostile-camera-split-budget-16384-r160/back-plus-180/gaussian-coverage-1.5/perspective-render-contact-sheet.png`
- `../held-hostile-camera-split-budget-16384-r160/elevated-plus-35/gaussian-coverage-1.5/perspective-render-contact-sheet.png`
- `../held-structure-direct-mass-v1-camera-split-r160/{recorded-native,side-plus-90,back-plus-180,elevated-plus-35}/gaussian-1024-coverage-1.5/perspective-render-contact-sheet.png`

Every listed frontier sheet was opened at original resolution. Columns are
teacher raymarch, Gaussian proxy, and absolute luma difference; rows increase
active count. The count frontier restores coherent projected structure without
camera-facing collapse. The optimized 1024 witnesses remain visibly smooth and
show held-view residual concentration.

## Kaminos Operator Routes

The live server is `http://127.0.0.1:8097/` from this exact worktree. Each route
below requested root `smoke-oracle`, resolved through same-origin `/api/read`,
reported `registered`, decoded the expected `1920x1365` sheet, and sampled more
than 6100 nonblank pixels. Authority is
`matched-raymarch-vs-world-space-gaussian-count-frontier`; downgrade is
`cpu-proxy-not-production-compositor`.

- Native: `http://127.0.0.1:8097/index.html?kaminos_image_witness=1&image_root=smoke-oracle&image_path=held-native-camera-render-budget-16384-r160-640x455%2Fperspective-render-contact-sheet.png&image_title=Native%20count%20frontier&image_authority=matched-raymarch-vs-world-space-gaussian-count-frontier&image_downgrade=cpu-proxy-not-production-compositor`
- Held side: `http://127.0.0.1:8097/index.html?kaminos_image_witness=1&image_root=smoke-oracle&image_path=held-hostile-camera-split-budget-16384-r160%2Fside-plus-90%2Fgaussian-coverage-1.5%2Fperspective-render-contact-sheet.png&image_title=Held%20side%20count%20frontier&image_authority=matched-raymarch-vs-world-space-gaussian-count-frontier&image_downgrade=cpu-proxy-not-production-compositor`
- Held back: `http://127.0.0.1:8097/index.html?kaminos_image_witness=1&image_root=smoke-oracle&image_path=held-hostile-camera-split-budget-16384-r160%2Fback-plus-180%2Fgaussian-coverage-1.5%2Fperspective-render-contact-sheet.png&image_title=Held%20back%20count%20frontier&image_authority=matched-raymarch-vs-world-space-gaussian-count-frontier&image_downgrade=cpu-proxy-not-production-compositor`
- Held elevated: `http://127.0.0.1:8097/index.html?kaminos_image_witness=1&image_root=smoke-oracle&image_path=held-hostile-camera-split-budget-16384-r160%2Felevated-plus-35%2Fgaussian-coverage-1.5%2Fperspective-render-contact-sheet.png&image_title=Held%20elevated%20count%20frontier&image_authority=matched-raymarch-vs-world-space-gaussian-count-frontier&image_downgrade=cpu-proxy-not-production-compositor`

The exact route screenshots were visually inspected and preserved under
`kaminos-operator-route-v1/`: native SHA-256
`ee30e7bad88fb43e5a89a61f01f28d037657c8fe118d46e0f523d93463265fb8`, side
`cc3fa8119b03a82fa78895a242c9532e5ef40460c279397d077cc8e1b3b84195`, back
`754c23bcc57e2e403df280423481a75d465ea205da70b278de42a32677ead948`, and
elevated `0bd5029d082f74ae9c59d20e59a8f3eba128cceff952bcc78769e7d0b692840e`.

## Verdict

Gaussian representation is not disqualified by this static assay. The prior
phrase "fine structure only" was false: 1024 lacks articulated mesostructure at
thumbnail scale. Count recovers that structure consistently across disjoint
cameras, so the observed wall is primarily an active-splat budget wall, with a
quality/cost knee near 8192 for this state. Above that knee, overlap and CPU
raster cost grow materially while visual and held-view gains diminish.

This does not promote 8192 splats into the shipping hybrid. The next in-custody
evidence action is an 8192-count temporal continuation assay that measures
feature correspondence and count/topology pressure; the required shipping-GPU
compositor charge remains Handy-owned acceptance work.

## Reproduction

```sh
node smoke-gaussian-oracle-fitter.mjs \
  --manifest /Users/noahlyons/.local/state/kaminos/volume-basins/operator-live-basin-0715/viewer-manifest.json \
  --manifest-sha256 553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa \
  --out-dir artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-fit-budget-16384-r160 \
  --budgets 4096,8192,16384 --density-threshold 0 \
  --optimizer recursive-moment-split

node smoke-gaussian-oracle-renderer.mjs \
  --fit-report artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-fit-budget-16384-r160/oracle-fit-report.json \
  --raymarch-png artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-teacher-r160-640x455/dense-raymarch-smoke.png \
  --out-dir artifacts/smoke-gaussian-oracle-ceiling-0715/held-native-camera-render-budget-16384-r160-640x455 \
  --budgets 4096,8192,16384 --extinction-scales 0.008 \
  --coverage-scales 1.5 --projection native-camera
```
