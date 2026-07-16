# HDR splat presentation parity witness

This witness compares the existing direct-additive world-covariance splat presentation with the same splat accumulation resolved through the exact effective raymarch presentation transform. It is presentation-only evidence: support, count, positions, covariance, radius, sharpness, learned attributes, authored layers, simulation state, target, and the 21-camera orbit are unchanged.

## Narrow verdict

Matched presentation removes the splat overexposure while preserving the moving world-covariance structure across the frozen orbit. It does not establish optical or self-transmittance parity with the raymarch. The raymarch still shows a broader, more volumetric upper plume, so that question remains for the separately authorized matched optical/self-transmittance arm.

## Source identity

- Kaminos implementation and witness commit: `6b978de1ec63782896803c212679531568fd9e16`
- Frozen capture: `filament-orbit-f96-s96`, frame 96, simulation step 96
- Backend: `WebGPU:apple`
- Requested page route: `/volume-selective-head-live.html`
- Effective wrapper route: `exact-basin-selective-head-live-v0`
- Effective renderer route: `native-3d-compute-fluid-raymarch-v0`
- Controls SHA-256: `dd8b25a6fad4775355e539d58d107fc7a26588ac23e7ec123a5d0eb999bb406f`
- Candidate payload SHA-256: `cd3b16f070193bf6f83d0862f55300d0967b8dd1949fe35d69eefc85f97b5b4d`
- Candidate count: `147389`
- Fluid SHA-256: `d58df9b715f0e7cd21b2e97811e5f19b2ecf2e7494a7e2bbc3866f61fcb94ac1`
- Front SHA-256: `1fd70b831b7f377d2923288715ca6ccbe26939790fd51b8f759ffb7c00ff29e8`

## Presentation arms

`current-additive-v0` renders directly into `rgba8unorm` using `direct-additive-presentation-v0` with `additive-rgb-gaussian-alpha-v0` blending. `matched-presentation-v0` preserves the same additive splat blend in an unclipped `rgba16float` intermediate, then resolves with `raymarch-matched-exponential-power-grade-v0` using exposure `0.96`, vignette base `0.80`, vignette gain `0.18`, and power `0.84`.

Both arms completed 21 captures with identical camera pose, controls, candidate count, and candidate payload hashes. The matched arm reported no fallback, no nonfinite channels, no intermediate clamp, pre-resolve RGB maxima from `3.5234375` to `4.17578125`, and `183102` accumulated channels above one. Mean displayed luma changed from `41.51283517484377` to `36.098971603536484`, a `13.041420920795165%` reduction.

## Visual inspection

The dynamic witness is `matched-presentation-frozen-r3/presentation-orbit.mp4`: 21 frames, 6 fps, 3.5 seconds, H.264, `942x242`. Columns are current additive, matched presentation, and 160-step raymarch. Its storyboard contains every encoded frame in sequence. The sparse native contact sheet contains cameras 0, 10, and 20 in the same column order.

Across the full storyboard, the ridge folds move continuously and retain their structural granularity in both splat arms. The additive arm repeatedly compresses the crest into yellow-white bands; the matched arm reveals amber crest layers and violet lower structure without changing the folds. The raymarch preserves related motion but remains broader above the ridge. These observations were made from the native frames and the complete 21-frame storyboard, not from nonblankness or metrics alone.

- Dynamic witness SHA-256: `66bf18af8bac5d4ecf79d683ef9bb37a578869a8da400eeed6a41b89b11bd4b1`
- Sparse contact sheet SHA-256: `868999e633b427630bc94b52a7f6f08377cca2aa83e4c5a4ba5768ca2958fa9b`
- Full storyboard SHA-256: `8e4b929bc784000b4acf98069c9f7984718f7fcb1d309ad25243b0641dc55109`
- Compact parity report SHA-256: `6873938f233d0b02895e901e0e546d7a1b3c1818fabc9bec69d8a45e9ef47b9c`
- Full orbit report SHA-256: `e7665dcb243f2688a02399958d5fe3c765af4c735b76338352a1e525358fdb37`
- Camera holdout report SHA-256: `af6d5fd9c5982a8cc580088db9c10272379d66a65603af3d2d3e0372ea2b8b18`

## Evidence behavior

The first two recovered attempts failed at `route-admission` because the rebooted anchor was respectively absent and then missing cross-origin headers. Their primary reports remain `status: failed`; neither can claim parity. The successful r3 compact report is `status: completed`, has `failurePhase: null`, passes `validateSplatRadianceParityReport`, and records 337 native captures in the delegated full-orbit report. A repeated frozen raymarch capture had zero changed pixels and identical pixel hashes.

Fail-first history was reconstructed against parent `a624c879`: the new HDR target assertion failed specifically because the old splat core did not contain `rgba16float`. False-closure tests reject failed, fallback, clamped, partial, wrong-route, wrong-hash, and stale-primary evidence. Independent GPT-5.5/Codex review found one P1 stale-primary-report path in `6ef7d00b`; repair `6b978de1` atomically replaces that path with failed evidence and records the displaced report identity. A fresh confirmation review found no material findings.
