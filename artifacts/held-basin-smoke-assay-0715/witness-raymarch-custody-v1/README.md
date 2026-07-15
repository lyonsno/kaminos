# Held Raymarch Smoke Custody Witness

Question: Does the checksum-bound held fluid import reach the frozen
smoke-only raymarch shader, independently of splat rendering?

Result: Yes. The imported field contains nonzero smoke in 3,900,122 of
4,096,000 cells (mean 0.453724, max 1.806267). The frozen raymarch binds the
exact imported fluid SHA-256, emits 172,017 non-background target pixels, and
records nonzero shader smoke authority in 171,651 pixels. The beauty frame
still makes D appear effectively empty against the dark scene, so this closes
import/binding/shader custody only; it does not make D a competent appearance
reference.

Route:

- repo: `/Users/noahlyons/dev/kaminos`
- worktree: `/private/tmp/kaminos-handy-held-basin-smoke-assay-0715`
- branch/base head: `cc/handy-held-basin-smoke-assay-0715` at `342d036` plus
  the custody instrumentation under review
- command: `node held-basin-smoke-assay-witness.mjs --url 'http://127.0.0.1:18715/held-basin-smoke-assay.html?comparison=competence&assay_manifest=./artifacts/held-basin-smoke-assay-0715/held-smoke-competence-source.json&assay_manifest_sha256=3f698a27a65f293e531c8c63e85667289a7470c787780f23ebe6cc046b138e40&manifest_sha256=553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa' --out-dir artifacts/held-basin-smoke-assay-0715/witness-raymarch-custody-v1 --report artifacts/held-basin-smoke-assay-0715/witness-raymarch-custody-v1/report.json --settle-ms 2200 --load-timeout-ms 240000 --chrome-port 19432`
- renderer route: `native-3d-compute-fluid-raymarch-v0`
- composition: `smoke-raymarch-only-v0`
- comparison profile: `dense-splat-competence-v0`
- browser: Google Chrome, owned CDP session on port 19432
- device adapter identity: not propagated by this witness
- source manifest SHA-256: `553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa`
- fluid SHA-256: `9a3cc037648b05de94197ec3d3451a0f8986ac3360b3379de374a1b409feda20`
- camera identity: `sha256:24600dbb7f6b677ea45f82e78f198701cdf0dfde586a2e8d15a60c37030d6994`
- timestamp: `2026-07-15T14:38:14.950Z` to `2026-07-15T14:38:37.305Z`

Artifacts:

- `held-smoke-competence.png`: inspected U/B/D frame; D remains visually dark
  even though the shader smoke-authority receipt is nonzero.
- `report.json`: exact source, route, import statistics, binding, target-pixel,
  shader-feature, failure-check, and image-hash evidence.

Hashes:

- `held-smoke-competence.png`:
  `5abf7c7df7161aa3ca4c151c74ccf707671f57e7a64a656f6ae635a0c7776e23`
- `report.json`:
  `04cb72170f08adb36f6e59690443150624d304db1481677feb870a468d314e0c`

Does not prove: plausible analytical smoke, parity with the raymarch beauty
ceiling, temporal smoke coherence, hostile-view stability, learned
sparsification quality, or an acceptable illuminated smoke appearance.
