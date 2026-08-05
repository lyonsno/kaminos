# Positive-volume C(P0) visual admission

Question: Does the W-seeded positive-volume P0 candidate preserve the authored
35-degree elbow transition without flattening, pinching, or erasing it, while
improving on the frozen scalar 0.72 collar control?

Result: VISUAL_CANDIDATE_ACCEPTED for authored-relation transfer testing. In
both profile and three-quarter views, the candidate preserves the swelling and
directional turn of the authored sleeve. No visible flat hinge, waist pinch, or
region erasure appears. The concentrated outer-bend strain patch is reduced
relative to the scalar control. This admits the mechanism to the next transfer
assay; it does not admit anatomy, production behavior, product quality, or the
weekly joined object.

Route:
- repo: kaminos
- worktree: `/private/tmp/kaminos-golden-cp0-visual-consumer-0805`
- branch: `cc/golden-cp0-visual-consumer-0805`
- source head: `cc9aff92293bf1edd9c2b42f2e1b7fa88d5ad8a8`
- candidate artifact: `artifacts/analytical-elbow-positive-volume-c-p0-v0/c-p0.json`
- candidate artifact SHA-256: `4facc5ba2d018fce24d749966f46c4041ee95279cd5d31e642024a0ad90f4005`
- requested/effective route: `analytical-elbow-positive-volume-c-p0-witness`
- backend/device: Chrome headless WebGL on the local macOS runtime
- input controls: exact synthetic mammalian elbow sleeve, 40x24 topology,
  35-degree flexion, frozen scalar 0.72 control, W-derived P0 candidate, paused
- original admission resolution: 1440x1100 viewport
- source-bound receipt resolution: 1440x900 viewport; each comparison canvas is
  720x405
- captured: 2026-08-05T19:11:56Z

Commands:

```sh
node analytical-elbow-positive-volume-c-p0-live-smoke.mjs --url "http://127.0.0.1:4187/artifacts/analytical-elbow-positive-volume-c-p0-witness-v0/index.html?camera=profile" --expected-source-sha 4facc5ba2d018fce24d749966f46c4041ee95279cd5d31e642024a0ad90f4005 --screenshot artifacts/analytical-elbow-positive-volume-c-p0-witness-v0/smoke/source-bound-profile.png --report artifacts/analytical-elbow-positive-volume-c-p0-witness-v0/smoke/source-bound-profile-receipt.json

node analytical-elbow-positive-volume-c-p0-live-smoke.mjs --url "http://127.0.0.1:4187/artifacts/analytical-elbow-positive-volume-c-p0-witness-v0/index.html?camera=three-quarter&wire=1&rest=1" --expected-source-sha 4facc5ba2d018fce24d749966f46c4041ee95279cd5d31e642024a0ad90f4005 --screenshot artifacts/analytical-elbow-positive-volume-c-p0-witness-v0/smoke/source-bound-three-quarter.png --report artifacts/analytical-elbow-positive-volume-c-p0-witness-v0/smoke/source-bound-three-quarter-receipt.json
```

Images:
- `profile.png`: original load-bearing profile admission frame; SHA-256
  `dc57c4a18ce941efee992657bcd6f445bd0421689e63fc4acb985293e7dd4e6f`.
- `three-quarter-wire-rest.png`: original load-bearing overlay admission frame;
  SHA-256
  `b530cd0ece44f9d4204f5dd40329a6c2cd9283352bfe62bd3ae02eda658200a6`.
- `source-bound-profile.png`: exact-candidate-hash profile confirmation; SHA-256
  `7f18d292adb69ceb865bed16b127a12a85d4837d3a6a83146c07a2ddc65fef33`.
- `source-bound-three-quarter.png`: exact-candidate-hash three-quarter
  confirmation with posed and rest wire overlays; SHA-256
  `ec10ba387fe6c4d9d65f1e7123ea3bff24713c584407d2c9fe653592e074c2ea`.
- `pre-binding-profile.png` and `pre-binding-three-quarter.png`: preserved first
  captures from before the source artifact hash was exposed to browser state;
  they are not admission evidence.
- `source-bound-*-pre-overlay-check.*` and
  `source-bound-*-pre-cleanup-accounting.*`: preserved source-bound intermediate
  runs from before the independent-review fixes; the canonical source-bound
  images and receipts supersede them.
- `three-quarter-cleanup-failed.png`: trustworthy source-bound capture whose
  command reported failure only during temporary Chrome profile cleanup; it is
  preserved for chronology but superseded by `source-bound-three-quarter.png`.

Receipts:
- `browser-smoke-receipt.json`: original admission route and image identities.
- `source-bound-profile-receipt.json`: exact source hash, route, camera,
  overlay state, geometry counts,
  paused state, canvas readback, and screenshot hash.
- `source-bound-three-quarter-receipt.json`: same contract for the overlay view.
- `three-quarter-cleanup-failed-receipt.json`: successful capture receipt from
  the superseded cleanup-failure run, explicitly classified
  `captured_with_cleanup_failure` at phase `browser-cleanup`.

Does not prove: transfer to an authored cat-armature relation, recovery after
semantic decoding, compatibility with the executable E/P/D program, useful
pose quality on the selected weekly object, anatomy, or production admission.
