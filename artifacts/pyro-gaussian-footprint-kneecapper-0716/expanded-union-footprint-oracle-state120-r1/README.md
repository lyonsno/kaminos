# State 120 Expanded Union Footprint Oracle

Question: Does a deterministic, view-independent, flow-oriented projected footprint improve the exact expanded Ridge plus Non-Ridge coefficient reconstruction across held-out views without changing candidate support, coefficients, optical density, state, or target?

Result: Yes, modestly and consistently. The area-conserving flow-oriented ellipse reduces held-out native RGB MAE from `0.037600855` for nearest projection to `0.033900914`, a `9.84%` improvement across the 20 held-out cameras. Every held-out camera improves. It also beats the independently path-refit flow-bilinear treatment (`0.034416999`) by `1.50%` while retaining the nearest treatment's frozen path scale. Visual inspection at cameras 00, 10, and 20 shows reduced directional comb/stipple with the bowl rim, sheets, cavities, and side filaments intact.

The exact state-120 union contains `1,899,742` uncapped candidates. This is a production cost emergency, not evidence that expanded support is visually useless. A separate two-anchor census found a truthful `626x` count swing against Integration's 3,033-candidate witness, but the anchors differ in source field, state, and controls; that ratio is not yet a pruning-policy measurement.

## Page

`index.html` is a self-contained interactive comparison across all 21 cameras. It displays exact raymarch target, nearest projection, flow-tangent bilinear, and flow-oriented ellipse, with an aligned target wipe. It verifies the state, candidate count, output completeness, path-scale freeze, and Greenroom receipt before displaying evidence. Missing, partial, capped, or wrong-state reports fail visibly.

## Route

- Repo: `/private/tmp/kaminos-pyro-gaussian-footprint-kneecapper-0716`
- Branch: `cc/pyro-gaussian-footprint-kneecapper-0716`
- Ellipse implementation commit: `e6393e08`
- Greenroom job: `c5bea0cdd3e1`
- Backend: local MLX/Metal Python oracle through GPU Greenroom
- Effective state: coefficient state 120, simulator frame 120, simulator step 120
- Candidate authority: `external-native-cell-index-list-v0`
- Candidate count: `1,899,742`; dropped rows `0`; sample cap `null`
- Coefficient boundary: `per-sample-pre-tone-map-emission-extinction-v0`
- Shared transport: `ridge-plus-non-ridge-extinction-one-running-transmittance-v0`
- Order approximation: `camera-depth-96-bin-one-running-transmittance-v0`
- Target: exact same-state shared-transmittance Intrinsic target
- Nearest path scale: `4.467670150820181`
- Bilinear path scale: `4.557231148404257`, independently fit on camera 10
- Ellipse path scale: `4.467670150820181`, frozen from nearest
- Ellipse identity: `flow-tangent-five-by-three-area-conserving-ellipse-quadrature-v0`
- Ellipse command: `/private/tmp/kaminos-mlx-residual-venv/bin/python volume-layer-coefficient-render-oracle.py --manifest /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-layer-coefficient-corpus-r4/training-manifest.json --capture-report /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-imported-coefficient-orbit-state120-r2/capture-report.json --out-dir /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-kneecapper-coefficient-ellipse-state120-r1 --report /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-kneecapper-coefficient-ellipse-state120-r1/report.json --state-step 120 --depth-bins 96 --footprint-mode ellipse --path-scale 4.467670150820181`

## Files

- `images/camera-XX-target.png`: exact shared-transmittance raymarch target.
- `images/camera-XX-nearest.png`: exact coefficients with nearest projected footprint.
- `images/camera-XX-bilinear.png`: exact coefficients with flow-tangent five-tap bilinear footprint.
- `images/camera-XX-ellipse.png`: exact coefficients with area-conserving flow-oriented ellipse.
- `reports/*.json`: complete oracle reports for all three treatments.
- `receipts/greenroom-ellipse.json`: effective Greenroom route and completion receipt.
- `sha256sums.txt`: hashes for the page, reports, receipt, and all 84 images.

## Claim Boundary

This result proves that current flow orientation carries useful, view-independent projected-footprint information and that footprint integration accounts for a measurable part of the residual. It does not prove that 1.9 million candidates are required, that the current selector is production-appropriate, that exact local coefficients are learnable at the same quality, that the 96-bin ordering approximation is exact, or that the remaining appearance gap is all footprint error. Candidate reduction requires a matched-state contribution or ablation assay, not the unmatched `626x` census ratio. The raw 900x960 live witness used radius `0.98` and sharpness `12`, far from the operator-accepted `0.80/6.5` and structural `0.55/4.2` regimes, so it is not a fair production-look judgment.
