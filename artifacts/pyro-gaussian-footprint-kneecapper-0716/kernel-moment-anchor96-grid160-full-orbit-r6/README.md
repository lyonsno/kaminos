# Kernel Moment Covariance Full Orbit R6

## Decision

The flow-kernel rank-one tangent covariance is a real view-independent geometry improvement on the current Structural/Ridge-Owned candidate set. Against world-gradient tangent covariance, one fixed set of descriptors lowers held-out support-aligned mean absolute channel error from `11.7679796481` to `8.0994734366` (`31.17%`) and support-aligned edge loss from `0.0121093762` to `0.0108805557` (`10.15%`) across 20 cameras.

The training camera improves by nearly the same amount: `30.28%` in support-aligned pixel error and `10.52%` in support-aligned edge loss. This is not a training-view-only close.

The full-flame pixel residual is not the right closure predicate for this treatment because the fixed candidate set intentionally omits legitimate non-ridge flame support. Kernel covariance raises held-out Full Flame MAE by `6.22%` while lowering Full Flame edge loss by `3.99%`; visually it removes hot faceting and preserves ridge cavities without inventing the absent upper plume.

## Optical Result

The shared-transmittance contribution sum reconstructs the complete smoke-off raymarch across held-out cameras with mean absolute channel delta `0.0000027965` and maximum channel delta `1`. This acquits layer decomposition and shared extinction composition at the current numerical tolerance. The ridge-only contribution becomes darker under total-flame extinction, as expected; it should remain a separately composable layer rather than be baked into one splat set to conceal missing candidate support.

## Greenroom Receipt

- Job: `969278ea9565`
- Status: `done`, exit `0`, no failure phase
- Effective cwd: `/private/tmp/kaminos-pyro-gaussian-footprint-kneecapper-0716`
- Effective backend: `WebGPU:apple`
- Effective wrapper route: `exact-basin-selective-head-live-v0`
- Effective renderer route: `native-3d-compute-fluid-raymarch-v0`
- Effective timeout: `null`
- Ray steps: `96,160`
- Camera angles: 21 values from `-0.42` through `0.42` radians
- Kernel strength/radius/coherence: `1 / 0.03 / 1`
- Frozen state: `filament-orbit-f96-s96`
- Controls SHA-256: `ba122038332747804203b4d03c6a5e9bf7b1e5969ec5d1f5ef995d3b5adff5b9`
- Fluid SHA-256: `d58df9b715f0e7cd21b2e97811e5f19b2ecf2e7494a7e2bbc3866f61fcb94ac1`
- Front SHA-256: `1fd70b831b7f377d2923288715ca6ccbe26939790fd51b8f759ffb7c00ff29e8`
- Candidate count: `147389`
- Candidate SHA-256: `447a7819ac3fc616d58b084708b138ef912f013e7ee56fe820225b4cdb93aa18`
- Admitted overflow: `0`
- Frozen repeat pixel delta: exactly `0`
- Kaminos commit: `ddf6f9f2ee1c00b1b30ffc7aa5b603457360f9b0`
- Model identity: `exact-basin-selective-carrier-heads-160-to-128-v0`
- Learned attribute set: `sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472`
- Completed timestamp: `2026-07-16T23:45:41Z`

The producer command was `gpu-greenroom submit kaminos_kernel_moment_covariance_orbit_witness <exact-route> <r6-output> -p ray_steps=96,160 orbit_angles=<21 angles> expected_frame_count=96 expected_sim_step_count=96 expected_controls_hash=ba122038332747804203b4d03c6a5e9bf7b1e5969ec5d1f5ef995d3b5adff5b9 expected_warmup_authority=checksum-bound-exact-basin-step96-field-anchor-v0 expected_warmup_target=96 expected_anchor_fluid_sha256=d58df9b715f0e7cd21b2e97811e5f19b2ecf2e7494a7e2bbc3866f61fcb94ac1 expected_anchor_front_sha256=1fd70b831b7f377d2923288715ca6ccbe26939790fd51b8f759ffb7c00ff29e8 flow_kernel_strength=1 flow_kernel_radius=0.03 flow_kernel_coherence=1 server_port=18224 chrome_port=49231 settle_ms=1800`. `greenroom-receipt.json` preserves the complete requested URL, exact expanded effective command, effective defaults, cwd, timeout, and completion fields without abbreviation.

The Greenroom `volatile_output` warning is resolved by committing this artifact directory on the owning feature branch.

## Images

- `camera-00-*`, `camera-10-*`, and `camera-20-*`: held-out left endpoint, training center, and held-out right endpoint comparisons. The `raymarch`, `stateDerivedSupport`, `worldCovariance`, and `kernelMomentCovariance` variants are the load-bearing geometry set.
- `camera-10-ridgeTransportRidgeExtinction-160.png`: ridge-owned emission and extinction at the center camera.
- `camera-10-ridgeTransportTotalExtinction-160.png`: the same ridge emission under total-flame extinction.
- `camera-10-nonRidgeTransportTotalExtinction-160.png`: complementary non-ridge emission under total-flame extinction.
- `camera-10-sharedTransmittanceContributionSum-160.png`: shared-transmittance recomposition, visually and numerically coincident with the complete target.
- `gallery-smoke-desktop.png`: inspected geometry page at `1440 x 1100`.
- `gallery-smoke-mobile.png`: inspected optical-layer page at a CDP-emulated `390 x 1200` viewport.
- `checksums.sha256`: hashes for the load-bearing image, report, and receipt subset.

Every raw camera image was produced by the Greenroom command above. The gallery screenshots were produced from the registered artifact route on port `18223`; `gallery-smoke-receipt.json` records requested/effective route equality, dimensions, image completeness, interaction state, control bounds, and zero browser events.

## Failure Receipts Preserved

- `r1`, job `768606dc2740`: argument validation rejected a one-value ray-step list.
- `r2`, job `62888f7f7bf4`: route admission failed because the anchor server was absent.
- `r3`, job `115881624e6c`: browser CORS rejected a cross-origin anchor server.
- `r4`, job `b077225e54dd`: exact anchor applied, then the old pre-kernel controls hash was correctly rejected.
- `r5`, job `c81889bb2e51`: exact route and frozen state applied, then footprint preflight rejected the partial `147389 / 131072 / 16317` candidate draw.
- `r6`, job `969278ea9565`: same-state capacity growth admitted all `147389` candidates and completed the full orbit.

Each failed run directory preserves its generated `report.json`, server log, and full `greenroom-receipt.json`; none is overwritten by the successful run.

## Evidence Boundary

This assay holds simulator state, positions, candidate support, optical coefficients, learned attributes, global radius, sharpness, and cameras fixed. It varies only the supported footprint treatment. The kernel descriptor supplies a first-moment center and rank-one tangent second moment; it is not full 3D covariance. The result supports a focused view-independent descriptor/trainer contract for the current ridge-owned support, not whole-manifold or Non-Ridge closure.

Open `index.html` through the local Kaminos artifact server for the 21-camera geometry, optical-layer, and ray-step views.
