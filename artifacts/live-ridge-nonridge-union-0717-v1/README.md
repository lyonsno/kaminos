# Live Ridge/Non-Ridge Union Witness

This is the first uncapped live witness for `kernel_moment_full_flame_union` on Kaminos commit `db060b42c203188331d0ead73460896a230e4c18`.

## Identity

- Requested/effective mode: `kernel_moment_full_flame_union`
- Requested/effective selector: `explicit-source-field-operator-v0`
- Selector recipe SHA-256: `541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9`
- Composition: `separate-ridge-nonridge-shared-total-extinction-v0`
- Backend: `WebGPU:apple`
- Effective renderer route: `native-3d-compute-fluid-raymarch-v0`
- Same-state capture: `live-union-f137-s137`

## Counts And Falsifier

The main capture emitted 3,033 candidates: 0 Ridge-only, 2,565 Non-Ridge-only, and 468 overlap. Final overflow was zero, candidate count equaled instance count, and no capacity retry was needed. Stable native-cell IDs hash to `b94126d0c2e6442d1b219f0e6996dd5bc25ca132be9d8c5eff9715b565b8517a`.

The independent zero-gradient capture retained the same 468 Ridge candidates while Non-Ridge-only and overlap both fell to zero. Its GPU `zeroGradientAdmissionCount` was zero. Restoring the authored gradient reproduced the main candidate, attribute, native-cell, and control hashes exactly without advancing the simulation step.

## Visual And Cost Read

The inspected PNG is nonblank: 55,305 of 645,120 pixels are lit. It shows a compact pink-white luminous body with a blue-violet lower lobe. This proves visible live raster application, but it is not a visual-quality claim: it is overexposed and lacks the authored Flamebowl's sparse sheet structure.

Measured browser-side elapsed times were 12.7 ms for the main frozen render, 8.8 ms for the full candidate/descriptor audit, 3.5 ms for the zero-gradient render, and 3.2 ms for the restored render. These are wall-clock browser measurements, not isolated GPU timestamps.

The operator-visible CDP screenshot is nonblank while the legacy offscreen `sampleFrame` readback is black. The report records this mismatch explicitly; visual authority belongs to the inspected canvas screenshot, not the black offscreen texture.

## Artifacts

- `report.json`: complete requested/effective receipts, stable ID ranges and hashes, counts, controls/state hashes, projection/frame diagnostics, falsifier, and timings.
- `full-flame-live-ridge-nonridge-union.png`: inspected operator-visible canvas capture.

## Reproduction

```sh
node volume-live-nonridge-union-witness.mjs \
  --url 'http://127.0.0.1:18781/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_resolution=64&volume_boundary_sidecar_source=baked&volume_boundary_sidecar_view=off&volume_boundary_splat_mode=off&volume_render_scale=1&volume_steps=88' \
  --out-dir artifacts/live-ridge-nonridge-union-0717-v1 \
  --timeout-ms 180000 \
  --settle-ms 1000
```
