# Authored envelope nonlinear basin-threshold assay

This assay separates two questions that ordinary decimation would confound:

1. How much representational density does FLUX need before it stops respecting the authored envelope?
2. At comparable density, how much anatomically legible structure does the envelope need before preservation improves nonlinearly?

The density pass is executable now. All five sources come from the same evaluated Blender object, transform, camera, material, and lighting. Automatic collapse remains visually coherent through `r050`; `r030` is the transition cell; `r015` is retained as a known breakdown control, not mislabeled as an aesthetic LOD.

The saved Blender revisions are preserved under `structural-ladder/` because they prove that meaningful operator refinements occurred at roughly comparable mesh density. Visual inspection rejected them as the primary quality axis: chronology is not sufficiently monotonic or pronounced to stand in for controlled structural degradation.

The structure pass therefore uses two small operator-authored derivatives specified in `operator-structure-variants.md`. The initial campaign does not cross every density with every structure condition. It reads both axes independently, then spends the first interaction cell at `S1 × r050` only if the independent effects are distinguishable.

The density pass is complete. FLUX stayed in essentially the same happy fur-bearing organism basin from 2,070 through 615 triangles; the first obvious local structural breakdown appeared at 307 triangles. This makes structural organization, rather than ordinary polygon density, the next primary uncertainty.

Open `density-pass-results.html` for the adjacent source/prompt/settings/output comparison and `RESULT.md` for the research interpretation. `density-pass-ledger.json` preserves exact effective routes, hashes, job receipts, durations, the supporting SSIM signal, and five malformed submissions that failed before inference.

The density result does not establish a universal polygon threshold. At the two lowest cells, automatic decimation increasingly damages both density and structure. The next pass therefore uses the same-density operator-authored derivatives in `operator-structure-variants.md`.
