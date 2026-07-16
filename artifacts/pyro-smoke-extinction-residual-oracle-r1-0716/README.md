# Physical Smoke Extinction Residual Oracle R1

This artifact asks whether exact simulator carriers omitted by the frozen 1,024-Gaussian `smokeDensity` control contain useful tall-smoke support. It does not test learned prediction or production integration.

## Roles

- **Exact physical target:** dense R160 step-45 ray integration of `0.74 smokeDensity + 0.42 microdetail + 0.34 interfaceShred + 0.12 detail`.
- **Frozen control:** the accepted 1,024-Gaussian broad `smokeDensity` scaffold, with mass scaled by `0.74` and no refit.
- **Residual only:** all 49,536 positive 4x4x4 source-volume blocks from the three omitted carriers. This is an additive term, not a standalone reconstruction.
- **Combined:** the frozen control plus residual, 50,560 Gaussians total.

The source manifest is `sha256:ab980bee692fbf6e91a3868201893e95e7ba2f170a036905a1b1eca4312f1d1a`; the effective route is `native-3d-compute-fluid-raymarch-v0`, backend `WebGPU:apple`. The combined product is `sha256:09e43194d5b02714c8fb6fd899358efd44f79aaf568b09b073f2af80a40b158b` and conserves physical extinction to `6.9954e-11` relative serialized error.

## Result

One proxy extinction scale (`0.2`) was calibrated on combined/recorded-native, then frozen with coverage scale `1` for every role and camera. Combined reduces luma MSE over control by `91.18%` native, `88.27%` side +90, `89.56%` back +180, and `67.54%` elevated +35.

The inspected visual result is narrower than the metric gain. Combined visibly restores the missing upper extinction envelope in all views, but the 4x4x4 oracle leaves horizontal bands, stays too column-centered, and misses the target's asymmetric tongue and interior sheet topology. This is positive evidence for the carrier field and negative evidence for block-center Gaussian realization. It does not pass the strict articulated static gate.

## Inspect

Open [`witness/contextual-sheets/index.html`](witness/contextual-sheets/index.html) for the context-bearing record. The page labels all four roles and all four cameras, records the field equation and calibration, and applies the same display-only 8x exposure to every panel. [`all-cameras-exposure8x.png`](witness/contextual-sheets/all-cameras-exposure8x.png) is the single-browser captured copy that was visually inspected.

Raw authority lives in [`source-step45/oracle-report.json`](source-step45/oracle-report.json), the dense teacher reports under `witness/teachers/`, and each role/camera `render-witness-report.json`. The next admissible experiment keeps the carrier equation and frozen control fixed while replacing block-center placement with a residual-weighted local-sheet/hierarchy oracle.
