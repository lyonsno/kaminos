# Pyro Smoke Matched Optics R5

## Question

Does the articulated-smoke failure remain when the exact dense physical smoke body, a connectivity-preserving sparse reconstruction, and the R2 independent full-covariance Gaussian mixture use the same camera, world-volume mass units, extinction coefficient, and Beer-Lambert transfer?

## Roles

- **Dense direct:** exact R160 step-45 physical smoke body, sampled trilinearly from all cells.
- **Connected sparse grid:** every positive physical-body cell preserved with exact value and six-neighbor connectivity. It is an analytical ceiling, not an affordability claim.
- **Analytic Gaussian:** reviewed R2 full-covariance product, with every Gaussian integrated in closed form along the finite camera ray. Serialized cell-sum mass is converted to world-volume mass by the exact voxel volume before applying extinction.

All roles use `T = exp(-tau)` and display `1 - T`. The explicit raw-extinction coefficient is `0.731 = 0.34 + 0.85 * 0.46`. PNGs use display-only exposure `8x`; metrics and `.f32` artifacts remain linear. This isolated witness does not claim production-compositor equivalence.

## Exact Source

- Oracle report SHA-256: `d6647887561039c1bc027da91d1c84bf5e634969bb02ebb36a33f969bdc1a50b`
- Native Gaussian fit report SHA-256: `071389905e419a2ae82e372ad2174e9b8529a657b93901ffd729b10866c2449b`
- Elevated `+35` fit/camera report SHA-256: `2cc083e8e61465ff3829756fc3230715d21fe5bde7edd6356ed62c51905abb5b`
- Gaussian artifact SHA-256: `1a3cfc24f6c0f66e4a629ee6e7d026b9ca47f509a94e7b6e6ccd185021b404e0`
- Native matched-optics report SHA-256: `34cd9544b823289054558eae09247353772599fe21add665623ac8163cec9382`
- Elevated matched-optics report SHA-256: `3706f1d0c3b860b0945022bd6118e277cfc7bc72b2897854275e90f8dcf57a92`
- Contextual comparison SHA-256: `d038d9bedfa546ae5625efd0816051b5f90f31be99f131079a61557bd56e2e88`
- Effective source route: `native-3d-compute-fluid-raymarch-v0`
- Effective backend: `WebGPU:apple`
- Grid and source state: R160, simulator step 45
- Physical cell-sum body: `3991.67974237063`
- World voxel volume: `1.9531250000000005e-6`
- Physical world-integrated mass: `0.007796249496817638`
- Gaussian world-integrated mass: `0.007796249497132901`

## Commands

```sh
node smoke-matched-optics-falsifier.mjs \
  --oracle-report artifacts/pyro-smoke-extinction-residual-oracle-r2-full-covariance-0716/source-step45/oracle-report.json \
  --expected-oracle-report-sha256 sha256:d6647887561039c1bc027da91d1c84bf5e634969bb02ebb36a33f969bdc1a50b \
  --expected-gaussian-fit-report-sha256 sha256:071389905e419a2ae82e372ad2174e9b8529a657b93901ffd729b10866c2449b \
  --out-dir artifacts/pyro-smoke-matched-optics-r5-0716/native \
  --width 320 --height 228 --samples-per-cell 1 \
  --extinction-coefficient 0.731 --display-exposure 8

node smoke-matched-optics-falsifier.mjs \
  --oracle-report artifacts/pyro-smoke-extinction-residual-oracle-r2-full-covariance-0716/source-step45/oracle-report.json \
  --expected-oracle-report-sha256 sha256:d6647887561039c1bc027da91d1c84bf5e634969bb02ebb36a33f969bdc1a50b \
  --camera-fit-report artifacts/pyro-smoke-extinction-residual-oracle-r2-full-covariance-0716/witness/combined/cameras/elevated-plus-35/oracle-fit-report.json \
  --expected-camera-fit-report-sha256 sha256:2cc083e8e61465ff3829756fc3230715d21fe5bde7edd6356ed62c51905abb5b \
  --out-dir artifacts/pyro-smoke-matched-optics-r5-0716/elevated-plus-35 \
  --width 320 --height 228 --samples-per-cell 1 \
  --extinction-coefficient 0.731 --display-exposure 8
```

## Quantitative Result

| Camera | Connected depth max error | Gaussian luma MSE | Gaussian normalized luma MSE | Gaussian max error / target peak |
| --- | ---: | ---: | ---: | ---: |
| Native `52d62666...` | `0` | `4.197480799e-7` | `0.00871130` | `0.195971` |
| Elevated `31fff60f...` | `0` | `2.001051587e-7` | `0.00346211` | `0.198070` |

The connected sparse reconstruction is bit-exact with dense in both cameras. It contains `2,993,279` positive cells in one six-neighbor component with `8,902,421` adjacency edges. That is 73.1% of the full R160 grid, so it proves a topology ceiling but is not sparse enough for product use.

## Visual Read

Open `context.html` or inspect `contextual-comparison.png`. Rows are native and elevated `+35`; columns are dense direct, connected sparse grid, and analytic Gaussian.

- Native dense/connected support forms a broad bent tongue with a bright asymmetric interior fold. The Gaussian arm replaces it with a centered horizontal stack and a stippled core.
- Elevated dense/connected support retains the lateral fold and cavity boundary. The Gaussian arm contracts that fold into granular central support.
- Dense and connected images are byte-identical in each camera. The Gaussian mismatch therefore survives matched mass, camera, coefficient, and Beer-Lambert optics.

## Disposition

The earlier projected-footprint proxy is not the primary cause of the visible collapse. Independent Gaussian moment compression loses connected sheet topology before optical composition. Present-state analytical support is valid, but exact positive-cell support is too dense for production.

The next justified experiment is an explicit connected local-sheet or surface extraction that preserves the one-component field's ridges, cavities, and adjacency at a materially smaller primitive count. A learned compressor remains premature until that analytical sheet ceiling is positive.

## Claim Boundary

This is a static, isolated, single-channel extinction witness at two cameras. It does not prove production compositor parity, scattering color, temporal stability, affordable sparse-grid execution, or a product-ready sheet representation. The Gaussian candidate pass uses an explicit projected Mahalanobis-squared window of `64`; contributions inside that window use the exact finite-segment 3D Gaussian integral.
