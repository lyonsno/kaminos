# Shared-Transmittance Flamebowl Witness

This artifact is the focused live witness for the four shared-transmittance optical-layer modes. It uses the immutable `big_raymarch_hero_flamebowl` settings preset (`vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2`) on requested role `truthHigh` and requested composition `raymarch-only-v0`.

## Result

- Status: `passed`
- Backend: `WebGPU:apple`
- Requested renderer route: `kaminos_volume_smoke=1`
- Effective renderer route: `native-3d-compute-fluid-raymarch-v0`
- Frozen state: frame `99`, simulation step `99`, capture id `shared-transmittance-f99-s99`
- Fallback: none for every visual mode and the MRT readback
- Postprocess authority: Ridge and Non-Ridge contributions sum in pre-tone-map linear radiance; independently tone-mapped image addition is false
- MRT authority: one fragment invocation writes Ridge, Non-Ridge, and Complete contributions to three `rgba16float` render targets
- Reconstruction: `0` violating components, maximum absolute error `0.0029296875`, mean absolute error `0.00006579780435957887`
- Declared tolerance: absolute and relative `0.00390625`

The canonical machine-readable receipt is `report.json`.

## Visual Artifacts

1. `transport-ridge-emission-ridge-extinction.png`
2. `transport-ridge-emission-total-extinction.png`
3. `transport-nonridge-emission-total-extinction.png`
4. `transport-complete-flame-total-extinction.png`

All four images were inspected after capture. Ridge emission under Ridge extinction preserves the thin sheet and lower blue structure. Applying total flame extinction visibly attenuates that same Ridge signal without changing its topology. Non-Ridge emission supplies the broad orange body. Complete Flame combines the sheet and broad carrier under the same total extinction.

## Measured Cost

These are same-state `sampleFrame` capture durations from this witness, not an isolated shader benchmark:

| Mode | Duration (ms) |
| --- | ---: |
| Ridge emission under Ridge extinction | 417.3 |
| Ridge emission under total flame extinction | 594.3 |
| Non-Ridge emission under total flame extinction | 613.9 |
| Complete Flame under total extinction | 520.2 |
| Four visual captures total | 2145.7 |

The MRT readback dimensions were `314 x 242`. A cooperative Greenroom lease was claimed for the bounded witness and released immediately after completion. Greenroom retains the exact private lease lifecycle receipt.

## False-Closure Receipts

- `failed-static-server-route-admission-report.json`: the first route used a static server whose preset API returned `404`; it failed during route admission instead of looking authoritative. Its non-authoritative absolute stack path is normalized to `/KAMINOS_WORKTREE` for publication.
- `failed-overloaded-witness-cdp-closure-report.json`: the legacy all-purpose presentation witness admitted the exact route and backend, then lost its CDP socket while carrying unrelated capture suites. Its non-authoritative absolute stack path is normalized to `/KAMINOS_WORKTREE` for publication.
- `single-call-probe.json`: a surgical MRT-only probe passed and localized the closure to the overloaded witness rather than the renderer.
- `report.json`: the focused four-mode visual plus MRT witness passed.

## Reproduction

With the settings-aware server running for this worktree, claim a cooperative GPU lease and run:

```sh
node volume-shared-transmittance-witness.mjs \
  --url "<exact Flamebowl selective-head route from report.json>" \
  --out-dir artifacts/shared-transmittance-flamebowl-0716-smoke \
  --report artifacts/shared-transmittance-flamebowl-0716-smoke/report.json \
  --timeout-ms 180000 \
  --settle-ms 2500
```

The witness rejects preset, role, composition, renderer route, backend, quality, camera, state, masks, postprocess, fallback, blank output, missing output, and reconstruction substitutions before writing a passing report.
