# Full Flame World Covariance Camera Holdout R2

## Result

The view-independent world-gradient tangent covariance is materially better than either conserved camera-facing billboard on the frozen Full Flame basin, and the gain survives all 20 held-out cameras. It does not close the complete Full Flame target.

Against the best held-out billboard baseline (`learnedBillboard`):

| Metric | Learned billboard | World covariance | Residual removed |
| --- | ---: | ---: | ---: |
| Full Flame mean absolute channel delta | 24.34434 | 18.83435 | 22.63% |
| Support-aligned mean absolute channel delta | 20.79062 | 8.72748 | 58.02% |
| Full Flame edge loss | 0.0145335 | 0.0144731 | 0.42% |
| Support-aligned edge loss | 0.0125211 | 0.0112002 | 10.55% |

Training-camera reductions are similar: 22.65% for Full Flame pixels and 58.95% for support-aligned pixels. This is not a training-view-only close.

## Visual Diagnosis

Native-resolution inspection at center and both grazing orbit endpoints agrees with the metric split. Analytic and learned billboards are nearly identical overbright, hard-edged shells. World covariance restores internal sheet texture, lowers the blown ridge, and follows the support-aligned target consistently across views. The remaining complete-target residual is dominated by broad warm upper filaments visible in the exact Full Flame target and the Non-Ridge partition but absent from the current Structural/Ridge-Owned candidate support.

## Decision Table

- **Global calibration closes:** no.
- **View-independent footprints close across views:** support-aligned majority, yes; complete Full Flame, no.
- **Training view closes but held-out views fail:** no; train and held-out gains agree.
- **No current footprint family closes Full Flame training view:** yes. The dominant localized ceiling is missing Non-Ridge candidate support, with remaining supported-region appearance/compositing error secondary.

The lawful claim is: world-oriented covariance explains a majority (`58.02%`) of the remaining support-aligned held-out pixel residual relative to the best billboard, while explaining only `22.63%` of the complete Full Flame residual. Candidate geometry is substantially stronger than the billboard images implied, but current candidate support is not a complete Full Flame representation.

## Receipt

- Status: `completed`
- Commit: `8ecc837f4670de43ea5221c5dc24001900a50f6c`
- Route: `exact-basin-selective-head-live-v0` -> `native-3d-compute-fluid-raymarch-v0`
- Backend: `WebGPU:apple`
- Preset: `big_raymarch_hero_flamebowl` / `vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2`
- Frozen state: `filament-orbit-f75-s75`; controls hash `cfa8700f93bb4e5c4720b5e399fc50d2c818d21545dbb0d403c1acbc5d25635a`
- Candidates: `80,935`; overflow `0`; candidate SHA-256 `ed17483d44563502dd05f4126f899eea3711292565c57a1fac2aba9684206f18`
- Cameras: one training (`10`), 20 held out (`0-9`, `11-20`)
- Frozen repeat: exact pixel hash match; zero changed pixels
- Conservation: `rendered-gaussian-integrated-alpha-conserved-v0`
- Covariance ceiling: tangent-plane diagonal covariance oriented by frozen support gradient; no free 3D rotation
- Support ceiling: current Structural/Ridge-Owned candidates omit legitimate Non-Ridge Full Flame filaments

## Artifacts

- Operator gallery: `index.html`
- Validated holdout report: `camera-holdout-report.json`
- Completed orbit report: `report.json`
- Complete pre-holdout capture report: `capture-report.json`
- Failed pre-canonicalization run: `../full-flame-covariance-wave-one-r1/report.json`
