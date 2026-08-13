# Representative SF3D comparison

Three source-specific route comparisons test where Stable Fast 3D may be more useful than the matched Trellis cast:

- overlapping stone slabs: rigid and separable parts;
- diffuse-lit dragon: horns, spines, claws, and ornate surface structure;
- generated skin: continuous organic anatomy and silhouette.

`campaign.json` freezes exact source and Trellis digests. `submissions.json` records the idempotent SF3D Greenroom submissions. `comparison-ledger.json` admits only exact terminal receipts and real GLBs. `comparison-sheet.html` places each source beside matched six-view SF3D and Trellis orbits.

The campaign supports source-specific route selection only. It does not establish general backend superiority or production admission.

## Result

Stable Fast 3D remains useful as a source-fidelity counter-route. It was visibly preferred for the rigid stone-slab source because it preserved the stocky silhouette and heavy plate masses. Trellis was visibly preferred for the ornate dragon and organic skin sources because its hidden-side completion produced more coherent whole objects.

The manual admission is frozen in `visual-disposition.json`. The six-view contact sheets used for that judgment live under `inspection/`; raw matched frames and orbit receipts live under `renders/`. The top-level `comparison-sheet.png` is the inspected capture of the adjacent HTML evidence surface.

Route identity is recorded in `comparison-ledger.json`: SF3D jobs ran through GPU Greenroom's `sf3d` route with `float16`, no remesh, and `1024` texture resolution; Trellis controls are exact existing `trellis2mlx_fast` casts bound by source and output hashes. All route images were rendered with Blender `5.1.2`, textured Workbench, orthographic projection, six azimuths, and 12-degree elevation.
