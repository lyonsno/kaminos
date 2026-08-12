# Authored-Cat Hidden-Carrier Diagnostic

Question: where does one global `0.94` inset fail when the authored synthetic coat depth varies spatially?

Result: the recovered carrier remains close in the short-coat region and leaves a large residual across the deeper medium-scapular region. The matched visual makes the same failure visible from lateral, anterior, and dorsal views.

Route:
- repo/worktree: `kaminos` / isolated Scrooge worktree
- branch/head: isolated feature worktree / `34c5c6989d1bb60491552a20104ee28d17987b40`
- command: `python3 artifacts/authored-cat-hidden-carrier-v0/render_hidden_carrier_diagnostic.py --repo-root . --assay-dir artifacts/authored-cat-hidden-carrier-v0/evidence/uniform-inset-medium-scapular-v0 --output-dir artifacts/authored-cat-hidden-carrier-v0/evidence/diagnostic-uniform-inset-medium-scapular-v0/run_001_34c5c698 --expected-report-sha256 37c8c15bc261bbf92c39db001020a5d4bc0c85659e3191c0029f46c1e2ddaf05`
- model/checkpoint: none
- backend/device: `python-numpy-stdlib-svg` on CPU
- input: terminal assay report `37c8c15bc261bbf92c39db001020a5d4bc0c85659e3191c0029f46c1e2ddaf05`, authored source `cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e`, `3764` corresponding vertices
- resolution: `1800 x 1180` SVG

Images:
- `hidden-carrier-diagnostic.svg`: authored hidden carrier, synthetic observed coat, uniform-inset recovery, and carrier-error heat map under three matched projections.
- `hidden-carrier-diagnostic.png`: full-resolution Chrome raster of the digest-bound SVG for inspection and the image-asset viewer route.
- `viewer-page-witness.png`: exercised Kaminos workbench capture; the image is registered and visible as a scene object.
- `source-assay-report-37c8c15b.json` and `source-assay-run-state-37c8c15b.json`: immutable copies of the exact terminal assay receipt consumed by this visual, preserved before the later parser-precedence-only assay rerun replaced the canonical current report.

Viewer witness:
- requested/effective route: `kaminos.asset-smoke-link.v0`, image asset link
- mounted root id: `lerms-preview`
- public image locator: `artifacts/authored-cat-hidden-carrier-v0/evidence/diagnostic-uniform-inset-medium-scapular-v0/run_001_34c5c698/hidden-carrier-diagnostic.png`
- registration: `image-810a5ccc-d492-4147-88bd-3267afc707af`, type `image`, `1800 x 1180`
- exact local-route witness report: status `ok: true`, preserved on the private coordination surface because it necessarily contains local worktree coordinates
- two preserved pre-registration failures: attempt 1 used the wrong expected server-root contract; attempt 2 established that the image-plane texture route does not accept the SVG text payload. The route then pivoted to the digest-bound PNG instead of retrying the unsupported asset form.

Safety characterization: deterministic isolated-background cat-envelope point projections; no generated biological corruption, infestation, repeated-orifice, misplaced-growth, or hostile imagery. Scrooge inspected the full-resolution PNG and the exercised workbench capture and admitted them safe for operator presentation. See `visual-admission.json`; operator visual admission remains separate.

Compatibility note: this run's `diagnostic-report.json` was emitted by renderer commit `34c5c698`, where `visualAdmitted: true` meant that the SVG passed renderer completeness checks. It did not mean operator admission; the same report's claim ceiling says so. The immediately following implementation revision renames that field to `visualArtifactValidated` and records `operatorVisualAdmission: not-requested` to remove the ambiguous surface.

Does not prove: image-derived coat depth or normals, volumetric recovery, arbitrary-source or anatomical truth, production grooming, deformation, consumer integration, or operator visual admission.
