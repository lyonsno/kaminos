# View-Conditioned Transfer Reduction Witness

Question: What do the saved state-120 camera-10 spatial/depth transfer reductions actually look like?

Result: Inspect `annotated-reduction-sheet.png` directly. The images are the evidence; this text only fixes their roles and route.

Roles:
- `analytical-target.png`: analytical same-state target for context only. It is not the reduction metric reference.
- `adapted-reference.png`: exact composition of the authenticated adapted 96-bin coefficient field and the metric reference for all reductions.
- `d1-t1.png` and `d1-t1-residual.png`: d1-t1 treatment and its 4x absolute tone-mapped RGB residual against `adapted-reference.png`.
- `d24-t1.png` and `d24-t1-residual.png`: d24-t1 treatment and its 4x absolute tone-mapped RGB residual against `adapted-reference.png`.
- `d24-t2.png` and `d24-t2-residual.png`: d24-t2 treatment and its 4x absolute tone-mapped RGB residual against `adapted-reference.png`.
- `d12-t2.png` and `d12-t2-residual.png`: d12-t2 treatment and its 4x absolute tone-mapped RGB residual against `adapted-reference.png`.
- `d12-t4.png` and `d12-t4-residual.png`: d12-t4 treatment and its 4x absolute tone-mapped RGB residual against `adapted-reference.png`.
- `d6-t8.png` and `d6-t8-residual.png`: d6-t8 treatment and its 4x absolute tone-mapped RGB residual against `adapted-reference.png`.
- `annotated-reduction-sheet.png`: the directly viewable, labeled comparison at native panel resolution.

Route:
- repo: /private/tmp/kaminos-pyro-view-conditioned-transfer-compression-0717
- commit: ab2ad100dd5bef802f6864727ddc060ba959f739
- command: `python view-conditioned-transfer-witness.py --input-manifest /private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/input-manifest.json --analytical-target artifacts/pyro-gaussian-footprint-kneecapper-0716/expanded-union-footprint-oracle-state120-r1/images/camera-10-target.png --treatment d1-t1=/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/reductions/d1-t1/report.json --treatment d24-t1=/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/reductions/d24-t1/report.json --treatment d24-t2=/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/reductions/d24-t2/report.json --treatment d12-t2=/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/reductions/d12-t2/report.json --treatment d12-t4=/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/reductions/d12-t4/report.json --treatment d6-t8=/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/reductions/d6-t8/report.json --out-dir artifacts/pyro-view-conditioned-transfer-reductions-state120-camera10-r1 --commit ab2ad100dd5bef802f6864727ddc060ba959f739`
- source manifest: `/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/input-manifest.json` (`c07a37517ad736ea69128984b8ef65bc8682a7df0668c2593246ce547d205c35`)
- transfer arrays: `/private/tmp/kaminos-pyro-view-conditioned-transfer-state120-camera10-r1/transfer-field.npz` (`4f37287be81ae00e23ff73c9a1d053ae3c251b492f07c722672bbad686f0a6f7`)
- route/backend: `state120-coefficient-plane-export-v0` / `numpy-cpu-v0`
- tone map: `oracle-exposure-0.96-power-0.84-uint8-v0`

Does not prove: parity with analytical raymarch, correct scene-geometry occlusion inside a grouped depth span, adjacent-camera validity, motion stability, or production economics.
