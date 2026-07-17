# Full Flame Deposition / Subcell Oracle R2

Question: With state, all `1,899,742` candidates, coefficients, opacity/extinction, shared transport, path scale, and camera orbit frozen, can a denser integration rule, a core-preserving compound deposit, or one view-independent residual-driven selective split materially beat the exact bilinear baseline without destroying target peaks and wisps?

Result: No current treatment closes. Bilinear remains the structural frontier. Dense `7 x 7` Gauss-Hermite integration and the `75%` bilinear core plus `25%` halo reduce dot spectral power and MAE slightly, but they materially worsen bright-tail and wisp underfit at approximately `9.77x` and `10.77x` projected work. The uncapped selective arm splits `4,336` candidates from one five-camera-derived, view-independent table and is held-view near-null: MAE improves `0.016%`, dot power improves `0.22%`, peak underfit worsens `0.10%`, and wisp underfit worsens `0.41%` on the exact 16-camera held cohort.

Route:

- repo/worktree: `/private/tmp/kaminos-pyro-gaussian-footprint-kneecapper-0716`
- treatment source commit: `fd670573`
- branch: `cc/pyro-gaussian-footprint-kneecapper-0716`
- harness: `volume-layer-coefficient-render-oracle.py`
- runner: `/private/tmp/kaminos-mlx-residual-venv/bin/python`
- backend/device: NumPy raster/composition under serialized GPU Greenroom custody; no fallback backend
- environment: `PYTHONPATH=.`
- timeout: none
- input: `kaminos-tiger-layer-coefficient-corpus-r4/training-manifest.json`
- capture: `kaminos-tiger-imported-coefficient-orbit-state120-r2/capture-report.json`
- controls: state `120`, grid `160`, depth bins `96`, path scale `4.557231148404257`, sample cap `null`, dropped rows `0`
- camera attribution: `0,5,10,15,20`; held cameras `1,2,3,4,6,7,8,9,11,12,13,14,16,17,18,19`
- Greenroom jobs: bilinear `bad0f6439e28`; higher-order `007b2d101883`; compound `6e9e3296b240`; selective `59d3377cc496`
- exact effective commands and timestamps: `receipts/*.json`

Images:

- `images/camera-XX-target.png`: exact frozen shared-transmittance Full Flame target
- `images/camera-XX-bilinear.png`: exact bilinear baseline
- `images/camera-XX-higher-order.png`: matched `7 x 7` Gauss-Hermite output
- `images/camera-XX-compound.png`: shared-mass `75%` bilinear core plus `25%` higher-order halo
- `images/camera-XX-selective.png`: one frozen view-independent selective split table reused across views
- `images/camera-XX-*-residual.png`: target-aligned native residual visualization from the producing harness
- `index.html`: interactive camera/treatment/output/residual comparator with matched held-camera metrics

Mass authority: Every arm conserves nominal pre-viewport optical coefficient mass on all 21 cameras. The frozen framing clips some deposited footprint mass on every camera; the reports expose per-channel retention and mark viewport mass non-decision-bearing. Image metrics remain decision-bearing for the exact frozen viewport.

Preserved anti-evidence: `r1-failures/` contains the first four failed reports and Greenroom receipts. R1 stopped at calibration because it incorrectly required center-visible coefficient mass to equal in-viewport deposited mass despite footprint clipping. Those failures are retained rather than overwritten.

Does not prove: This does not prove that full per-splat 3D covariance, orientation beyond the represented tangent/bitangent families, new optical support, altered coefficients, exact per-splat ordering, or a learned importance sampler cannot improve the result. It proves that these three current mass-conserving deposition refinements do not explain the meaningful peak/wisp residual at fixed support and coefficients. The leading next pressure is missing or misallocated optical support at luminance peaks and edge wisps, with 96-bin compositing/order remaining a named secondary ceiling.
