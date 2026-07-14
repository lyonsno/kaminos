# Spatial-Strata Hybrid Smoke Motion Witness V7

This bundle is the accepted revision-two witness for the first phase-matched
spatial-strata smoke renderer. It answers a narrow question: can independently
decoded, phase-offset flame instances drive a coherent smoke representation that
moves under an explicit render clock without advancing the fluid simulator or
borrowing visible motion from the flames?

## Verdict

Yes, at proof-of-tractability strength. The smoke pass advances under four
controlled render timestamps spanning 6000 ms while the simulator remains at
step 101. The hybrid frames move (`maxMeanAbsDiff = 0.4258016206351776`), while
the paired flame-only controls are effectively static
(`maxFlameControlMeanAbsDiff = 4.2425013788129477e-7`). A same-time repeat stays
within the witness tolerance (`meanAbsDiff = 0.002299435747316586`).

The visible result is not production smoke. In the static camera it reads as a
dim, detached smoke ceiling above four stable flames. In the grazing camera it
survives projection but reads as a broad low-frequency veil instead of an
articulated plume. The next representation problem is therefore spatial
articulation and flame-to-smoke attachment, not phase coherence or uncontrolled
splat-count growth.

## Bound Route

- Repository: `/Users/noahlyons/dev/kaminos`
- Worktree: `/private/tmp/kaminos-handy-live-splat-smoke-0713`
- Branch: `cc/handy-live-splat-smoke-0713`
- Source base at capture: `2ae19640fdcd0c7c2ab17cf0c62e54e222915ff9`
- Capture interval: `2026-07-14T01:43:31.847Z` to
  `2026-07-14T01:43:55.290Z`
- Backend/device: `WebGPU:apple`
- Browser viewport: `1280x960`; canvas captures: `1800x1746`
- Learned flame model: `sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472`
- Effective route: `spatial-strata-hybrid-smoke-v0`
- Smoke renderer: `phase-matched-spatial-strata-front-back-raster-v0`
- Composite renderer: `splat-depth-conditioned-front-back-smoke-compositor-v1`
- Source lifecycle: generation 1, loaded, no pending load, no failure
- Requested/effective source config: `motion-source.json`, fine LOD `1`, coarse
  coverage `1.8`, motion rate `0.16`
- Draw instances per hybrid frame: `9672`
- Rejected extinction mass: `0`
- Candidate count across captures: `1979`, with zero candidate churn

The witness was produced from the worktree root with:

```sh
node volume-boundary-splat-motion-witness.mjs \
  --url 'http://127.0.0.1:8237/?kaminos_volume_smoke=1&volume_scene=compact_plume&volume_boundary_splat_mode=learned&volume_boundary_splat_composition=hybrid-smoke&volume_boundary_splat_phase_mode=two-phase-alternating&volume_boundary_splat_instances=4&volume_boundary_splat_history_depth=4&volume_boundary_splat_history_frame_stride=1&volume_boundary_splat_layout=proof&volume_hybrid_smoke_representation=spatial-strata&volume_hybrid_smoke_manifest=.%2Fartifacts%2Fsmoke-spatial-strata-v2-0713%2Fmotion-source.json&volume_hybrid_smoke_fine_lod=1&volume_hybrid_smoke_motion_rate=0.16&volume_hybrid_smoke_coarse_coverage=1.8' \
  --out-dir artifacts/spatial-strata-hybrid-motion-v7-0713 \
  --report artifacts/spatial-strata-hybrid-motion-v7-0713/witness-report.json \
  --evidence-root "$PWD" \
  --chrome-port 19484 \
  --frames 4 \
  --step-ms 2000 \
  --wall-step-ms 300 \
  --hybrid-only
```

## Evidence Design

The harness freezes the simulator before capture and advances only the explicit
render-phase timestamp. Every static hybrid capture has an adjacent
`learned-splat-frozen-flame-control` capture at the same timestamp. Acceptance
requires all of the following:

- exact requested/effective route and source-config identity;
- identical simulator step counts across the sequence;
- smoke renderer elapsed seconds equal to the controlled timestamp in seconds;
- measurable hybrid-frame motion;
- negligible paired flame-control motion;
- bounded same-time repeat delta;
- nonblank, hash-recorded images contained inside this bundle;
- no fallback renderer, stale default config, missing spatial-strata source, or
  substituted raymarch route.

The witness also fails before browser launch on malformed numeric controls or a
non-positive wall delay and still writes a durable failure report naming the
startup phase.

## Visual Assets

- `static-hybrid.mp4`: controlled-time smoke motion with a frozen camera and
  frozen simulator.
- `static-hybrid-filmstrip.png`: four hybrid frames from the static sequence.
- `static-flame-control-filmstrip.png`: paired flame-only controls proving the
  flames did not supply the accepted motion.
- `grazing-hybrid.mp4`: the hybrid route under camera motion.
- `grazing-hybrid-filmstrip.png`: four hybrid frames from the grazing sequence.
- `grazing-flame-control-filmstrip.png`: paired flame-only grazing controls.
- `witness-report.json`: route, clock, lifecycle, render-product, image, and
  false-closure evidence for the complete run.

Important-asset SHA-256 hashes:

```text
6f3c943673ff2ae1453a4c13e99e3ccfe71a82b7fc898ccc2d64314c1b193a59  static-hybrid-filmstrip.png
f13413742e78900fadc2c0c40f501317df714d46d195b9d747b7713f095c3d61  static-flame-control-filmstrip.png
d77eeded563ad1ea5503f07ef4fcc86460e2faa62a22fad58fbc6e6f0ed96a1a  grazing-hybrid-filmstrip.png
abde57d59fde44445c2951bcbb592ac301a5012718df0733c9853fca3d78f59f  grazing-flame-control-filmstrip.png
3c0c62d411e8448bac95252e320cdb6a4ffc2bf0209d6cf1e57870fb1d0fb597  static-hybrid.mp4
16be12f301c56424e1d04c5c0cd2935c58e191b14ae77f6cd461e5c83464e791  grazing-hybrid.mp4
8cb23d06309af98210d933fdd6e9b3f9fbcdd71cfbfa45e4cf472a72bfe5dd70  witness-report.json
```

## Claim Boundary

This bundle proves controlled smoke-renderer motion, exact phase-source binding,
uncapped sparse/coarse product consumption, and a working hybrid depth resolve
for this source and camera pair. It does not prove production visual quality,
smoke/flame attachment, broad source generalization, view-complete ordering,
temporal smoothness at game cadence, or final performance.
