# Frozen Full-Flame Filament Camera Orbit

Question: On one frozen, smoke-off Flamebowl state, does a slow camera orbit make persistent non-ridge full-flame filaments flicker or disappear in the raymarcher, and how does that compare with state-derived ridge support and current analytic splats?

## Result

The strong camera-only omission hypothesis was not reproduced on this orbit. Across 21 poses spanning `-0.42` to `+0.42` radians, the upper non-ridge filament field changes continuously and no view-local target component crosses the witness's binary omission threshold at `48`, `96`, or `160` effective ray steps. Visual inspection of all four 21-frame contact sheets found coherent camera motion rather than random sparkle, abrupt topology replacement, or whole-filament dropout.

Ray-step dependence is nevertheless severe. Mean raymarch luma is `103.7758` at `48` steps, `86.6293` at `96`, and `60.2054` at `160`. Against the same-camera `160` image, `48` changes `63.3267%` of pixels with mean absolute channel delta `30.7637`; `96` changes `62.8189%` with delta `18.7201`. The non-ridge-target intensity ratio falls from `1.7467` at `48` to `1.4930` at `96` and `1.0316` at `160`. Lower budgets visibly overbrighten and thicken the flame rather than merely dropping sparse samples.

Camera sensitivity also falls with quality: mean adjacent-pose absolute channel delta is `4.9889` at `48`, `4.8336` at `96`, and `3.9985` at `160`. This is positive evidence for step-dependent integration instability, but not for abrupt camera-only filament omission at `160` on this arc.

Current analytic splats are camera-coherent but not a replacement for the non-ridge target. They preserve a coarse upper outer arc while collapsing much of the fine interior texture into a bright lower ridge. Every analytic capture reports `93,189` candidates, `93,189` instances, and zero overflow. The initial `92,380` count in the first ridge/non-ridge comparator records precedes the first analytic encode and is stale telemetry, not candidate churn.

Frozen determinism is exact: center-camera `160` reference and repeat both hash to `f67e5614dbf79d3ce91dea9bb8bdc20e6c08b8cf0d85d8a3baa30163e6efe4ea`; changed pixels, channel delta, frame-count delta, and sim-step delta are all zero.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-flicker-necromancy-auditor-0712`
- Branch/commit: `cc/pyro-flicker-necromancy-auditor-0712@d555e3156812f0c213c21ef371aeb9daea1e89a7`
- Server: lane-owned `http://127.0.0.1:18222/`; steward port `18215` was not reused or stopped.
- Operator route: `http://127.0.0.1:18222/artifacts/raymarch-filament-orbit-wave-one-0716-v2/operator-route.html`
- Requested wrapper: `/volume-selective-head-live.html`
- Effective wrapper/renderer: `exact-basin-selective-head-live-v0` / `native-3d-compute-fluid-raymarch-v0`
- Backend/browser: `WebGPU:apple`; `Chrome/150.0.7871.115`; one owned headless CDP browser on port `19396`, closed after capture.
- Preset: `big_raymarch_hero_flamebowl`, `vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2`, authority `shared-volume-settings-preset-v2`, `186` controls.
- Frozen state: `filament-orbit-f53-s53`; controls SHA-256 `cfa8700f93bb4e5c4720b5e399fc50d2c818d21545dbb0d403c1acbc5d25635a`.
- Source authorities: complete flame `smoke-off-complete-flame-local-emission-extinction-v0`; non-ridge target `nonnegative-non-ridge-flame-emission-coefficient-v0`; ridge support `state-derived-direct-flame-candidate-support-allocation-v0`; splats `live-boundary-sidecar-analytic-splats-v0`.
- Capture controls: smoke presentation `off`; simulator advance `false`; ray steps `48,96,160`; 21 camera poses; 127 PNG captures; no renderer fallback.

Exact witness command:

```sh
node volume-raymarch-filament-orbit-witness.mjs \
  --url "$(jq -r .requestedUrl artifacts/positive-flame-partition-flamebowl-0716-v1/report.json | sed 's/127.0.0.1:18781/127.0.0.1:18222/; s/volume_raymarch_smoke=on/volume_raymarch_smoke=off/')" \
  --out-dir artifacts/raymarch-filament-orbit-wave-one-0716-v2 \
  --debug-port 19396 \
  --orbit-angles=-0.42,-0.378,-0.336,-0.294,-0.252,-0.21,-0.168,-0.126,-0.084,-0.042,0,0.042,0.084,0.126,0.168,0.21,0.252,0.294,0.336,0.378,0.42
```

Focused and broader verification:

```sh
node tests/volume-raymarch-filament-orbit-witness-contracts.mjs
node tests/volume-intrinsic-presentation-witness-contracts.mjs
node tests/volume-appearance-decomposition-contracts.mjs
node tests/boundary-splat-motion-witness-contracts.mjs
node tests/volume-contracts.mjs
```

All five passed. A malformed-argument probe also exited nonzero and wrote `failurePhase: argument-validation`, proving that unknown CLI input does not silently fall back to defaults.

## Inspected Evidence

- `raymarch-160-orbit-contact.png` and `raymarch-160-orbit-10s.mp4`: highest-quality smoke-off raymarch orbit; coherent filament motion with no abrupt omission observed.
- `raymarch-48-orbit-contact.png` and `raymarch-48-orbit-10s.mp4`: low-step control; visibly brighter, thicker, and more camera-sensitive.
- `non-ridge-orbit-contact.png` and `non-ridge-orbit-10s.mp4`: exact positive non-ridge emission target.
- `analytic-splat-orbit-contact.png` and `analytic-splat-orbit-10s.mp4`: current analytic splats; coherent coarse arc and lower ridge, missing much fine interior texture.
- `camera-10-raymarch-{48,96,160}.png`: same-state center-camera step comparison.
- `camera-10-raymarchRepeat-160.png`: exact frozen repeat of the center `160` control.
- `camera-10-stateDerivedSupport-160.png`, `camera-10-nonRidgeFilaments-160.png`, and `camera-10-analyticSplat-160.png`: center-camera causal comparators.
- `report.json`: complete requested/effective route, camera, quality, state, pass, fallback, count, hash, pixel, and component telemetry.
- `SHA256SUMS`: hashes for the report and load-bearing visual artifacts.

## Does Not Prove

- This does not prove all cameras, basins, longer arcs, grazing views, or continuous sub-frame trajectories are free of ray-sampling omission.
- The binary component metric is view-local and saturates on broad overlapping emission; visual inspection and step/pixel metrics carry the width/radiance verdict.
- The result does not prove production-fire fidelity, smoke-on transport equivalence, learned-head quality, world-oriented covariance, or compositor suitability.
- No learner, production compositor, covariance implementation, candidate selector, or renderer integration behavior was modified by this lane.
