# State-120 optical path-scale A/B

Question: Does the dull, albedo-like held-state splat result come from the recurrence/representation, or from omitting a shared optical path scale from emission and extinction?

Result: On exact frozen state 120, scale `3.8845837491755066` raised pre-presentation mean linear luma from `0.009320038841183645` to `0.035176995862501496` and max linear RGB from `0.291259765625` to `0.9541015625`. The raw 16-bin emission/extinction deposit was byte-identical between arms (`c83a65eb2177158ff62f3be041f8fb927fb0653d2a45d9e81a3996f39442fb4a`). The inspected Beauty frame recovered a materially brighter luminous band. This strongly identifies missing optical path scale as the dullness mechanism.

Route:

- Repo/worktree: local Integration feature worktree; the unredacted route receipt is in the protected output directory below
- Branch/base head: Integration feature branch at `906e9f2ece9b2665cfd54c47d7a5f65947125cb3` before this implementation commit
- Renderer route/backend: `native-3d-compute-fluid-raymarch-v0` on `WebGPU:apple`
- State/grid: `coefficient-state-120`, simulation grid `160^3`, residual grid `16^3`
- Population: 481,447 sparse candidates plus 1,444,341 positive-complement candidates
- Depth transport: 16 camera-linear bins, far-to-near alpha-over
- Command: `node volume-four-arm-held-state-witness.mjs --route-receipt scratch/full-support-stage-a-18789/route-receipt.json --report /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-integration-optical-path-scale-ab-r4/report.json --scale-a 1 --scale-b 3.8845837491755066 --screenshot-a /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-integration-optical-path-scale-ab-r4/beauty-scale-1.png --screenshot-b /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-integration-optical-path-scale-ab-r4/beauty-scale-grid96-calibrated.png --linear-hdr-a /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-integration-optical-path-scale-ab-r4/linear-hdr-scale-1.f32 --linear-hdr-b /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-integration-optical-path-scale-ab-r4/linear-hdr-scale-grid96-calibrated.f32 --timeout-ms 900000`
- Full float HDR outputs: `/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-integration-optical-path-scale-ab-r4/`

Images:

- `observed-scale-1.png`: exact shared recurrence at effective scale `1.0`; visibly dim and albedo-like.
- `grid96-calibrated-probe.png`: same state, camera, deposits, support, coefficients, and presentation at effective float32 scale `3.8845837116241455`; visibly brighter.
- `receipt.json`: requested/effective route, scale, state, camera, grid, population, deposit hashes, pre-presentation HDR statistics and hashes, timing, and fail-loud browser audit.

Hashes:

- `observed-scale-1.png`: `504839841ee40fd3b4de6dbfab2ae3c1717a42403926fac558211211a5471529`
- `grid96-calibrated-probe.png`: `8a1775fa7076ab245100c66ac34c73a7caf594d30643d62f7344ae587dd03966`
- Scale-1 linear HDR: `66331748ff31b8046e7f9d6ff59646cab984825de14c07602d511a96ec563d99`
- Calibrated-probe linear HDR: `88e75ef9a548cb353fd9e04405d0d6f23824affe2fe276f512dcb6dd27a28836`

Does not prove: `3.8845837491755066` is not admitted as a Grid160 or cross-grid production constant. It is the authenticated Grid96 calibration applied here as a Grid160 mechanism probe. This A/B does not close the remaining directional hair/grid texture, deposition-unit calibration, footprint quality, or product-scale performance.
