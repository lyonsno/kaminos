# Restored Stage B Matched Optical Acceptance

## Disposition

- Cockpit Manifest V0: accepted as checksum-bound, loadable producer evidence.
- Narrow assay verdict: both presentation resolve and optical recurrence are
  material but incomplete.
- This is not a self-transmittance parity claim. Operator-authored visual
  exploration remains unseen, as recorded by the manifest.

## Source

- Greenroom job: `f207549d6850`, status `done`, exit `0`, no failure phase.
- Producer commit: `8509882187d87a8dd31d1fac9f8d9bde98f74444`.
- Immutable presentation baseline:
  `0859abf8d5b06359e4d2708f5b597c327b43c4af`.
- Frozen state: `filament-orbit-f96-s96`; frame/simulation step `96/96`.
- Backend: `WebGPU:apple`.
- Requested wrapper: `/volume-selective-head-live.html`.
- Effective wrapper: `exact-basin-selective-head-live-v0`.
- Effective renderer: `native-3d-compute-fluid-raymarch-v0`.
- Controls SHA-256:
  `dd8b25a6fad4775355e539d58d107fc7a26588ac23e7ec123a5d0eb999bb406f`.
- Candidate/support SHA-256:
  `cd3b16f070193bf6f83d0862f55300d0967b8dd1949fe35d69eefc85f97b5b4d`.
- Coefficient SHA-256:
  `684c6b41fc0afed0c20bd1fa2039b6f7d16fea414f3a826d351e14c8f2f5b5d7`.
- Covariance SHA-256:
  `5f5c90be924bf8237fed0c1f5d6cbc48e9842e8b1b761faa6d334d13661d51f0`.
- Candidate count: `147389`; overflow count: `0`.
- Fluid SHA-256:
  `d58df9b715f0e7cd21b2e97811e5f19b2ecf2e7494a7e2bbc3866f61fcb94ac1`.
- Front SHA-256:
  `1fd70b831b7f377d2923288715ca6ccbe26939790fd51b8f759ffb7c00ff29e8`.

## Arms

- `matched-presentation-v0`: `rgba16float`, additive RGB/Gaussian alpha,
  no optical transport, exact raymarch-matched exponential/power grade.
- `matched-optical-recurrence-v0`: 16 `rgba16float` layers, premultiplied
  emission plus optical depth, projected-NDC intervals, far-to-near alpha-over,
  `1-exp(-tau)` self-transmittance, and the unchanged presentation grade.
- Both arms have 21 nonblank captures, 21 unique camera poses, no fallback,
  no clamped intermediate, and exact source/hash agreement.
- Optical telemetry is complete: max emission `3.732421875`, max optical depth
  `4.50390625`, zero nonfinite channels, and one occupied depth bin.

## Dynamic Evidence

- `presentation-orbit.mp4`: 21 probed frames, 314x242, 6 fps, 3.5 seconds;
  SHA-256 `832471ca0c902c235bee7bc5b6e0cf35ad61d9cd7a634690c0dbac82ba4c6982`.
- `optical-orbit.mp4`: 21 probed frames, 314x242, 6 fps, 3.5 seconds;
  SHA-256 `dd6133a5135d5fc21378670f2cde90d2af0695c22e2415f382e19ea2e9fc74df`.
- Both native contact sheets and both independently video-decoded 21-frame
  sheets were personally inspected. Native cameras 0, 10, and 20 were also
  inspected for the raymarch, matched-presentation, and optical arms.
- Center-camera raymarch repeat hashes are identical, with zero changed pixels
  and stable frame/simulation counts.

## Visual Delta

- Relative to matched presentation, optical recurrence lowers orbit-mean
  displayed luma by `29.2936%` and mean peak luma by `48.7495%`.
- It preserves the moving world-covariance silhouette, folds, violet lower
  structure, and orbit response while removing the clipped-looking crest.
- It also over-darkens and flattens the amber crest relative to the raymarch,
  which remains broader, more luminous, and more internally layered.
- Only one of 16 projected-NDC depth bins is occupied. The optical correction
  is material, but this assay does not establish effective multi-depth
  recurrence or a matched visual ceiling.

## Integrity

- Optical report SHA-256:
  `8cb011b028d9a6aa93608ade84a98be1ae612b6eccd1cd6dfa5aef5ceebe8fa0`.
- Cockpit manifest SHA-256:
  `bc86516f468c9ce9b5306f8cc533819ab65453e5766f9e45ac696bca4d867732`.
- Full orbit report SHA-256:
  `5bc391bfd7abc539b780d40277bd52586545db0344897d48b50ac5b7f11a4ccd`.
- Presentation contact sheet SHA-256:
  `fcf87b599565143dfb709f569af42db4a78b72648994f25c8190a86ffc1ba4a5`.
- Optical contact sheet SHA-256:
  `18cc98a6ab85f11a1baf5a72ea44474d90db7c2a8b5adf92db4094faed5a790c`.
