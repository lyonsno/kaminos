# Held Raymarch Smoke Custody Witness R1

Question: Does the checksum-bound held fluid reach the frozen smoke-only
raymarch with distributed, material shader evidence after the review fixes?

Result: Yes. Revision one replaces one-pixel gates with deterministic
materiality floors and uses summary-only feature readback. The exact held field
contains nonzero smoke in 3,900,122 of 4,096,000 cells. The D target has
172,017 non-background pixels out of 533,052, and the shader smoke-authority
feature is nonzero in 171,651 pixels with max 135 and mean 29.1932. Both
receipts mark `materialEvidence: true`. The inspected beauty frame remains
visually dark in D, so this proves custody, not appearance parity.

Route:

- repo: `/Users/noahlyons/dev/kaminos`
- worktree: `/private/tmp/kaminos-handy-held-basin-smoke-assay-0715`
- branch/base head: `cc/handy-held-basin-smoke-assay-0715` at `c5f8316` plus
  review revision one
- command: `node held-basin-smoke-assay-witness.mjs --url 'http://127.0.0.1:18715/held-basin-smoke-assay.html?comparison=competence&assay_manifest=./artifacts/held-basin-smoke-assay-0715/held-smoke-competence-source.json&assay_manifest_sha256=3f698a27a65f293e531c8c63e85667289a7470c787780f23ebe6cc046b138e40&manifest_sha256=553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa' --out-dir artifacts/held-basin-smoke-assay-0715/witness-raymarch-custody-v2 --report artifacts/held-basin-smoke-assay-0715/witness-raymarch-custody-v2/report.json --settle-ms 2200 --load-timeout-ms 240000 --chrome-port 19433`
- renderer route: `native-3d-compute-fluid-raymarch-v0`
- composition: `smoke-raymarch-only-v0`
- comparison profile: `dense-splat-competence-v0`
- browser: Google Chrome, owned CDP session on port 19433
- device adapter identity: not propagated by this witness
- source manifest SHA-256: `553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa`
- fluid SHA-256: `9a3cc037648b05de94197ec3d3451a0f8986ac3360b3379de374a1b409feda20`
- camera identity: `sha256:24600dbb7f6b677ea45f82e78f198701cdf0dfde586a2e8d15a60c37030d6994`
- timestamp: `2026-07-15T14:48:50.422Z` to `2026-07-15T14:49:14.664Z`

Artifacts:

- `held-smoke-competence.png`: inspected U/B/D frame; image bytes are
  identical to v1, confirming the evidence-only revision did not alter pixels.
- `report.json`: exact materiality flags, source/binding identities, target
  pixels, shader smoke authority, route state, and image hash.

Does not prove: a visually competent D appearance reference, plausible
analytical smoke, temporal coherence, hostile-view stability, learned
sparsification quality, or final smoke rendering architecture.
