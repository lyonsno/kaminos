# Flow Kernel Moment Covariance: Flamebowl Local R7

## Question

Does a view-independent covariance frame derived from Handy's frozen flow-kernel second moments improve the uncontaminated world-gradient covariance baseline without changing candidate support, positions, learned appearance identity, simulator state, source preset, or cameras?

## Result

Yes on the modeled support, with a complete-target radiance tradeoff. Across four held-out cameras:

| Metric | World covariance | Kernel moments | Change |
| --- | ---: | ---: | ---: |
| Support mean absolute channel delta | 10.83257 | 8.71065 | 19.59% lower |
| Support edge loss | 0.0124962 | 0.0117499 | 5.97% lower |
| Full Flame mean absolute channel delta | 16.82441 | 18.40554 | 9.40% higher |
| Full Flame edge loss | 0.0136497 | 0.0128312 | 6.00% lower |

Native-resolution inspection at the center and both grazing endpoints agrees with the split. Kernel moments preserve the same ridge and sheets, reduce the blown faceting, and better follow the support-aligned target. They do not create missing support. The complete target's broad bright carrier rewards energy outside the current support-aligned objective, so the lower/smoother conserved kernel treatment loses Full Flame pixel score while improving edge agreement.

## False-Closure History

Local r5 is rejected because kernel preflight strength leaked into the non-kernel families. Independent GPT-5.5 review identified that preflight was recorded but not bound to admitted payloads. The repaired r6 then failed loudly on the analytic attribute mismatch, exposing the control leak. R7 explicitly resets `flowKernelStrength=0` for every non-kernel family and passes exact preflight/admission hash equality.

Rejected evidence is preserved at `../kernel-moment-flamebowl-local-r5-invalid-flow-control-leak/`.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-gaussian-footprint-kneecapper-0716`
- Browser-reported HEAD during capture: `d2459f906855b86c04a3d37860ac7292b379a82c`
- Exact working-tree repair subsequently committed as: `639c94c0`
- Branch: `cc/pyro-gaussian-footprint-kneecapper-0716`
- Capture command:

```sh
node volume-raymarch-filament-orbit-witness.mjs \
  --url "$(jq -r .requestedUrl artifacts/pyro-gaussian-footprint-kneecapper-0716/kernel-moment-flamebowl-local-r7/report.json)" \
  --out-dir /tmp/kaminos-kernel-moment-flamebowl-preset-local-r7 \
  --orbit-angles=-0.42,-0.21,0,0.21,0.42 \
  --ray-steps=96,160 \
  --flow-kernel-strength=1 \
  --flow-kernel-radius=0.03 \
  --flow-kernel-coherence=1
```

- Requested/effective wrapper: `/volume-selective-head-live.html` / `exact-basin-selective-head-live-v0`
- Effective renderer/backend: `native-3d-compute-fluid-raymarch-v0` / `WebGPU:apple`
- Source: `big_raymarch_hero_flamebowl` / `vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2`
- Source authority: `shared-volume-settings-preset-v2`
- Frozen state: `filament-orbit-f45-s45`, controls SHA-256 `cade5c00c040b7dc3ede1037e6f81bc382fa5658d9787f56e1668b3e25175042`
- Candidate support: `91,108` Structural/Ridge-Owned rows, zero overflow, payload SHA-256 `a98f37b3ffa48c3c14335514237305a1d1c46400264edefd59b1011cbdcbbf43`
- Resolution/steps: immutable source grid `128`, render scale `0.296917052331791`, comparisons at `160` ray steps
- Cameras: center camera `2` is training; cameras `0`, `1`, `3`, and `4` are held out
- Kernel controls: strength `1`, radius `0.03` world units, coherence `1`
- Comparison controls: non-kernel flow strength explicitly `0`
- Model/checkpoint: no learned covariance model; deterministic analytic flow-kernel descriptor consumption
- Output completeness: `71` captures, exact frozen-repeat pixel match, all requested families/cameras present

## Images

- `camera-02-raymarch-160.png`: exact smoke-off Full Flame target.
- `camera-02-stateDerivedSupport-160.png`: target contribution allocated to current candidate support.
- `camera-02-worldCovariance-160.png`: uncontaminated view-independent world-gradient baseline.
- `camera-02-kernelMomentCovariance-160.png`: flow-kernel-moment covariance treatment.
- The same four roles are preserved for cameras `00`, `01`, `03`, and `04`.
- `index.html`: interactive camera comparison and held-out metric table.
- `camera-holdout-report.json`: validator-admitted metric, preflight, and identity report.
- `report.json`: complete capture receipt and false-closure checks.

Center-frame SHA-256:

| Image | SHA-256 |
| --- | --- |
| Full Flame target | `1ad4c039f8e25be001eebf5a0d5c3aeb4ea665050a53354a106c2bc32cf85c53` |
| Support target | `f0cfb419c1b1545c4a706768d8141a2e3a329df5722fb0783e8cb3b274c61600` |
| World covariance | `94d6288f4df19c89f23e55b2a7b584d7180fb6359dcc1ca71391a51bb7c93fbd` |
| Kernel-moment covariance | `d1c9b23316b1eb56d71003b4da222957e61ba5bfb89ff85a366ba163d2590ce7` |

## Does Not Prove

This local run does not prove full-orbit closure, whole-combustion-manifold coverage, or that strength `1` and radius `0.03` are optimal. It uses the immutable Flamebowl preset's `128` grid and `0.2969` render scale, not the proposed early-manifold `140` grid at `0.35` scale. It cannot create candidate support absent from the Structural/Ridge-Owned row set, and the Full Flame MAE tradeoff requires an opacity/extinction assay rather than a geometry-only conclusion.

## Gallery Smoke

- Operator route: `http://127.0.0.1:18223/artifacts/pyro-gaussian-footprint-kneecapper-0716/kernel-moment-flamebowl-local-r7/index.html`
- Desktop inspection: `gallery-smoke-desktop.png`, SHA-256 `9c2e4d0ecb40b551b519f45fe74ab3839989d14b6b515275547c83c5dc2b01ba`
- Mobile CDP inspection: `gallery-smoke-mobile.png`, SHA-256 `791263aa547a511d53af15b903b85957039d9464cd7ba5a9b20ac1c59710c4f8`
- Route/layout receipt: `gallery-smoke-receipt.json`; requested and effective routes agree, all four images loaded, the camera interaction moved from training Camera 02 to held-out Camera 03, document scroll width equals client width, and both camera buttons are inside the true `390px` viewport.
- Rejected mobile witness attempts: `gallery-smoke-mobile-overflow-before-fix.png` and `gallery-smoke-mobile-window-crop-before-cdp.png`. The latter demonstrated that macOS headless `--window-size=390` cropped a wider minimum layout viewport and therefore lacked mobile viewport authority.
