# Tri-radial Skeleton Proposal Fan V0

## Campaign state

The authored tri-radial projection can survive a concise image-generation pass and a Trellis reconstruction as a coherent, happy, textured three-limbed character. The route is therefore viable as disposable proposal scaffolding for a subsequent operator-authored envelope. The current result does not yet make all three limbs read unambiguously as ground supports; the frontal source projection still permits one chain to acquire an arm-like role.

## What changed

The fan separated several prompt terms that had previously been treated as nearly interchangeable:

- `armature` is the strongest geometry-preserving term in this source condition.
- `skeleton` is not neutral. It selects exposed-bone and humanoid priors strongly enough to dominate otherwise concise completion prompts.
- `animal` is not neutral either. With `friendly`, all three matched seeds collapse the authored tri-radial relation into ordinary quadrupeds.
- `lower body` preserves the source relation but suppresses useful elaboration.
- `friendly` can change affect without necessarily destroying the tri-radial projection. The best initial cell, seed `80301`, retains three independently legible limb chains.
- `friendly creature` without `animal` still collapses the source into conventional upright bipeds.
- `three-footed` changes distal anatomy locally, but it does not override the stronger bilateral arm-and-leg interpretation induced by the frontal projection.

This places the useful prompt basin between two observed boundaries: semantic language strong enough to finish the structure erases it, while language that protects the lower-body relation can leave the source essentially untouched.

## Reconstructed candidate

The selected `p06 / seed 80301` proposal was reconstructed through the effective `trellis2mlx_fast` route. The resulting GLB loaded through Kaminos's registered mesh route and passed the `mesh-asset-link` witness. The cast is visibly coherent and textured, and the third chain exists as geometry rather than a 2D-only suggestion.

The strongest supportable claim is narrow: one happy three-limbed completion survived the FLUX-to-Trellis route. The result does not establish anatomical correctness, three-footed stance, contact compatibility, motion compatibility, or a general prompt recipe.

## Program consequence

The proposal route no longer needs a feasibility assay. Its next consumer can be the operator-authored low-frequency envelope. The matched prompt fan is exhausted for this frontal source plate: another wording sweep is lower leverage than changing the projection or using the reconstructed cast as disposable scaffolding. Prompt work should not become a prerequisite for authoring the first envelope around the reconstructed cast.

## Effective routes

FLUX used `mflux_flux2_edit_promptfile` with `flux2-klein-9b`, Q4, `512 x 512`, 8 steps, guidance `1.0`, and matched seeds `80301`, `80302`, and `80413`.

The selected reconstruction used `trellis2mlx_fast`, seed `80301`, resolution `512`, 6 steps, no cascade, target 200,000 faces, texture size 1024, and simplify-first.

## Evidence

- Source and campaign contract: `campaign-contract.json`
- Follow-up contracts: `follow-up-contract.json`, `boundary-pulse-contract.json`
- Operator-safe adjacent assay sheet specification: `operator-safe-matrix.json`
- Sheet render command: `node tools/build-assay-matrix.mjs artifacts/triradial-skeleton-proposal-fan-v0/operator-safe-matrix.json artifacts/triradial-skeleton-proposal-fan-v0/operator-safe-matrix.html`
- Selected proposal: `runs/p06-seed80301/output.png`
- Reconstructed cast: `trellis/p06-seed80301/output.glb`
- Kaminos witness report: `trellis/p06-seed80301/kaminos-witness.json`
- Kaminos witness frame: `trellis/p06-seed80301/kaminos-witness.png`
