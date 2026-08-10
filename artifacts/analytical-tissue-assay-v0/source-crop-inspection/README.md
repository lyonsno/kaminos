# Legacy hindquarter source-crop inspection

Question: Does one bounded region in the current admitted cat-bauplan source visibly contain enough rigid relation, layered mass transition, and articulated silhouette to serve as a legacy stress row for the first analytical tissue assay?

Result: Yes, narrowly. The right sagittal crop contains the posterior vertebral/pelvic relation, a dense layered hindquarter muscle mass, and the long leg silhouette in one frozen view. It is suitable as a unilateral legacy geometry stress row. The source is visibly incomplete and asymmetric, so the crop is not anatomical truth, a bilateral fixture, or a species-control witness.

Route:

- repo: `kaminos`
- research worktree: `/private/tmp/kaminos-analytical-tissue-assay-0810`
- source branch: `cc/molten-cat-analytical-carrier-0805`
- source branch head inspected: `49b6fd5c6aab3036d3acf867853e8c7d5a8f4523`
- source artifact: `artifacts/cat-bauplan-analytical-carrier-v0/source-preview-r2-complete/ecorche/right-sagittal.png`
- requested/effective renderer: `blender-cat-source-preview-v0`
- effective backend: Blender `5.1.2`, `BLENDER_WORKBENCH`, palette `ecorche`
- source asset: `/Users/noahlyons/dev/operator-scratch/blender-scenes/cat-bauplan.blend`
- source asset SHA-256: `9453608cdf721ee98ad2924ac16a459b7b810d96159566133e7a573327b9744c`
- source camera: right sagittal orthographic, direction `[1, 0, 0]`, image up `[0, 0, -1]`, ortho scale `68.95558166503906`, 900×900
- extraction: immutable Git archive from `cc/molten-cat-analytical-carrier-0805`; no re-render or fallback route
- crop command: `sips --cropToHeightWidth 680 380 --cropOffset 80 0 20260810T204449_source-right-sagittal.png --out 20260810T204449_hindquarter-crop.png`
- inspected: 2026-08-10 by the analytical tissue assay owner

Images:

- `20260810T204449_source-right-sagittal.png`: immutable 900×900 source render copied without pixel changes; SHA-256 `43e7f5038c6a3f56f7da4e9741336636dc75ce54c276a58622eab17384b8896f`.
- `20260810T204449_hindquarter-crop.png`: inspected 380×680 crop showing the bounded posterior stress region; SHA-256 `e6b15bd4349878a2244bcf8a6601d6e0a90ceae3cbb56e9a46ad2c39b26e53df`.
- `source-candidate-identities.json`: exact legacy geometry identities and bounds recovered from the committed source classification.
- `receipt.json`: requested/effective source, renderer, camera, crop, and hash custody.

Does not prove: anatomical naming; feline specificity; correctness of the provisional muscles; bilateral completeness; fat, tether, or skin identities in the authored source; a valid control perturbation; surface continuity; generator preservation; reconstruction; registration; deformation; motion; or production admission.
