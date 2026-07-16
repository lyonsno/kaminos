# Ridge Cross-Extinction Camera Holdout R10

## Question

Does extinction from legitimate Non-Ridge flame volume explain the remaining mismatch between the fixed world-covariance splat reconstruction and the Ridge-owned target?

The causal pair holds Ridge emission fixed and changes only its transport:

- Ridge-only: `E_R` through `sigma_R`.
- Cross-extinction: the same `E_R` through `sigma_R + sigma_N`.

The same three-dimensional state and candidate payload are reused across one training camera and 20 held-out cameras. Positions, support, simulator state, model source, camera set, and authored controls do not move between the pair.

## Result

No. Non-Ridge cross-extinction is substantial and coherent across views, but it moves the Ridge target farther from the current world-covariance reconstruction.

| Held-out mean | Ridge-only target | Total-extinction Ridge target | Residual removed by cross-extinction |
| --- | ---: | ---: | ---: |
| Full-frame mean absolute channel delta from world covariance | 11.96498 | 15.96493 | -33.43% |
| Ridge-support-masked mean absolute channel delta | 29.68964 | 40.87232 | -37.66% |
| Edge loss from world covariance | 0.0119760 | 0.0119000 | +0.63% |

Every held-out camera agrees in sign. Full-frame residual change ranges from `-32.38%` to `-34.64%`; support-masked change ranges from `-36.04%` to `-39.42%`. Cross-extinction slightly improves edge placement while materially worsening radiance agreement. Visually, it darkens the interior Ridge contribution, while the fixed world-covariance splats are already much brighter and more saturated than the Ridge-only target.

The stronger compositing result is positive: Ridge and Non-Ridge contributions accumulated separately under one running total transmittance recompose the independently accumulated Complete Flame control exactly at the training camera and within one 8-bit channel level over all held-out cameras. This is the lawful additive boundary: add pre-tone-map contributions that share `T_total`, not two independently rendered layer images.

## Interpretation

The remaining Ridge mismatch is not explained by simply applying the omitted Non-Ridge extinction to the existing world-covariance reconstruction. The leading local suspects are now the reconstruction's emitted-energy/opacity calibration, its extinction kernel or opacity-to-extinction semantics, and the remaining footprint/orientation ceiling. Cross-layer extinction can still matter in the final compositor, but it is not the missing correction that would close this Ridge reconstruction.

This result does not argue for flattening semantic layers into one primitive set. Separate authored Ridge and Non-Ridge layers remain useful; they must participate in one optical traversal or an equivalent shared-transmittance formulation.

## Visual Inspection

Center camera and both orbit endpoints were inspected at native capture resolution. The same visible ordering survives all three views:

- World covariance is overbright and more saturated than either Ridge transport target.
- Total extinction is visibly darker than Ridge-only extinction, especially through the interior and lower sheet network.
- Non-Ridge under total extinction carries the broad upper plume and diffuse interior fill.
- The shared-transmittance contribution sum is visually identical to Complete Flame; the report bounds the held-out difference to one channel level.

Use `index.html` to scrub all 21 cameras and compare every causal image directly.

## Receipt

- Status: `completed`
- Greenroom job: `a66252ab4067`
- Greenroom job type: `kaminos_ridge_cross_extinction_orbit_witness`
- Kaminos commit: `fff34a32d272c5db9e4c956ec9888c095e22bbca`
- Branch: `cc/pyro-gaussian-footprint-kneecapper-0716`
- Worktree: `/private/tmp/kaminos-pyro-gaussian-footprint-kneecapper-0716`
- Requested wrapper: `/volume-selective-head-live.html`
- Effective wrapper: `exact-basin-selective-head-live-v0`
- Effective renderer: `native-3d-compute-fluid-raymarch-v0`
- Backend: `WebGPU:apple`
- Source route authority: `checksum-anchor-bridge-explicit-controls-hash-v0`
- Warmup authority: `checksum-bound-exact-basin-step96-field-anchor-v0`
- Frozen state: `filament-orbit-f96-s96`; frame `96`; simulation step `96`; grid `160`
- Controls SHA-256: `dd8b25a6fad4775355e539d58d107fc7a26588ac23e7ec123a5d0eb999bb406f`
- Fluid SHA-256: `d58df9b715f0e7cd21b2e97811e5f19b2ecf2e7494a7e2bbc3866f61fcb94ac1`
- Front SHA-256: `1fd70b831b7f377d2923288715ca6ccbe26939790fd51b8f759ffb7c00ff29e8`
- Candidate count: `147,389`; overflow `0`
- Candidate payload SHA-256: `cd3b16f070193bf6f83d0862f55300d0967b8dd1949fe35d69eefc85f97b5b4d`
- Cameras: training `10`; held out `0-9` and `11-20`
- Captures: `295`; all nonblank; all frame/simulation counts `96/96`
- Frozen repeat: exact pixel hash `ae7a235230c70de89f706ecac3785203c24c6c2dd4a35c7642d03587729ef07d`; zero changed pixels
- Shared contribution recomposition: training max delta `0`; held-out max delta `1`
- Completed report SHA-256: `08cf8fa5e743f8635f178488b9769cfb451ba3f4094c8670bf37bbb0a27db4f3`
- Camera holdout SHA-256: `14fdc25cc7c16bc70692c515719a2296cb0d825c596c92a5194418c4fa63ca80`

This is a separately named step-96/grid-160 checksum-anchor bridge. It is not the unavailable live R2 frame-75 state and must not be represented as an exact reconstruction of that earlier state.

## Artifacts

- Operator gallery: `index.html`
- Inspected desktop gallery: `gallery-smoke-desktop.png` at `1440 x 1100`
- Inspected mobile gallery: `gallery-smoke-mobile.png` at a CDP-emulated `390 x 1200` viewport
- Gallery route/layout receipt: `gallery-smoke-receipt.json`; effective route equals requested route, status is `completed`, eight images loaded, document scroll width equals client width, and both camera buttons are inside the viewport
- Gallery witness command: headless Google Chrome with `--disable-gpu`, controlled through CDP `Emulation.setDeviceMetricsOverride` and `Page.captureScreenshot`; the receipt records requested/effective route, software backend, viewport, load state, and measured control bounds
- Rejected mobile smoke attempts: `gallery-smoke-mobile-overflow-before-fix.png` motivated the range-input constraint; `gallery-smoke-mobile-blank-capture.png` exposed the command-line screenshot route's unreliable cropping. Neither carries viewport authority.
- Completed orbit report: `report.json`
- Complete capture report: `capture-report.json`
- Validated holdout report: `camera-holdout-report.json`
- Final-validator failure that motivated strict bridge admission: `../ridge-cross-extinction-anchor96-grid160-frozen-r9/report.json`

Important artifact SHA-256 values:

- `index.html`: `6ead3f75a390f0432bfae82bded515077b0c0cb8aec7a03ff048b5daa06882cf`
- `gallery-smoke-desktop.png`: `86af9325dd6ba0fb1dd30cf6cdc2ef367230eb4563b664ecd69d68053bdc6082`
- `gallery-smoke-mobile.png`: `977813d557d89c493f49d7b72d964fa0b2ba1ab37ec74c924888b9eca723c474`
- `gallery-smoke-receipt.json`: `21830df11a0ce1ddeff03b8bc19026417a399db7758b950d212ae8147fb35d96`
