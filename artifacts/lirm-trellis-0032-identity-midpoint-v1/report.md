# Source 0032 Sparse-Guidance Identity Midpoint

## Question

Does sparse guidance CFG `3.0` recover the paired facial structure and radial crawler organization that are only partially present at CFG `2.0` and visibly present at CFG `4.0`?

## Effective Route

All rows use source `0032`, seed `42`, six steps, 512 structured-latent resolution, no cascade, simplify-first cleanup, a 200,000-face target, and 1K textures. Sparse guidance rescale remains `0.7` over `[0.6, 1.0]`; downstream shape guidance remains `7.5` with rescale `0.5` over `[0.6, 1.0]`. Only sparse guidance strength changes: `2.0`, `3.0`, and `4.0`.

The CFG `2.0` and `4.0` rows reuse the reviewed identity-bracket evidence. CFG `3.0` generation job `595078505e92` and corrected camera jobs `d3ece88fcb12`, `c9bf6adf51f2`, `4c4fdb3b934e`, and `54daeabe16ad` are admitted from canonical Greenroom receipts.

Four earlier midpoint witness jobs are preserved but excluded. Their labeled output directories named left/front/right/rear views, while every effective route silently used default yaw `0.0` because the submissions omitted `yaw`. They cannot support a multi-view claim.

## Visual Read

### CFG 2.0

The compact low crawler and one giant eye are visible, but the paired facial carrier and open-mouth organization are absent. Detached curved pieces remain. This is partial source identity.

### CFG 3.0

The midpoint is a coherent spatial creature across the corrected four views. It strengthens the compact radial crawler, open mouth, and low multi-limb organization. One giant eye remains stable, but the paired-eye facial organization does not return. The body has substantial broken-sheet and detached-limb artifacts. CFG `3.0` is a stronger partial-preservation regime, not the full source identity threshold.

### CFG 4.0

The compact upright cephalopod-like mass, two visible eyes, and broad radial limb ring return together. The mouth is still a looped invention and appendage joins remain broken, so this is not reconstruction closure or finished-asset quality.

## Decision

For source `0032` under this fixed route, the full visible carrier-set threshold is greater than CFG `3.0` and at most CFG `4.0`. CFG `3.0` is useful when more invention is desired while retaining one-eye crawler identity; CFG `4.0` is the first tested value that restores paired facial organization plus radial locomotion.

Stop the scalar sweep here. Another decimal search would refine a source-specific threshold without changing the current Kaminos decision: sparse-structure guidance is a useful visible crucible handle, its identity threshold is source-dependent, and route-bound multi-view receipts are required. The next valuable experiment should test the handle through a reusable agent-facing firing surface or on a new asset class, not keep polishing source `0032`.

## Artifacts

- `0032-identity-midpoint-contact-sheet.png`: admitted CFG `2/3/4` views.
- `experiment.json`: fixed controls, route identity, source and contact-sheet hashes.
- `route-receipts.json`: admitted generation/witness evidence plus the four excluded default-yaw witnesses.
- `build-assay.mjs`: re-runnable file-in/file-out assembler with route and PNG admission.
