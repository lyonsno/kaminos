# Core + Skirt Footprint Oracle, State 120 R1

This bundle compares eight view-independent footprint treatments on the exact frozen state-120, grid-160 expanded Ridge plus Non-Ridge candidate union. Every arm reuses all `1,899,742` admitted candidates, exact local emission/extinction coefficients, one shared total transmittance, the same 96-bin depth approximation, the same 21-camera orbit, and one frozen optical path scale of `4.557231148404257`.

Operator page:

`http://127.0.0.1:18223/artifacts/pyro-gaussian-footprint-kneecapper-0716/core-skirt-footprint-oracle-state120-r1/index.html`

Full path:

`/private/tmp/kaminos-pyro-gaussian-footprint-kneecapper-0716/artifacts/pyro-gaussian-footprint-kneecapper-0716/core-skirt-footprint-oracle-state120-r1/index.html`

## Treatment

The treatment preserves the five-tap tangent core and mixes an area-conserving three-tap normal skirt per candidate. `skirtMix=0` is exactly the flow-tangent bilinear endpoint. `skirtMix=1`, unit minor scale, and zero Ridge rejection are exactly the prior flow-oriented ellipse endpoint. Ridge conditioning uses the frozen `sidecar.ridge` feature:

`effectiveMix = globalMix * (1 - ridgeRejection * clamp(sidecar.ridge, 0, 1))`

No arm changes positions, support, candidate count, coefficients, opacity/extinction, ordering, cameras, simulator state, or target identity.

## Held-Out Results

| Arm | RGB MAE | Gradient MAE | Target-gradient underfit | Bright-tail underfit |
| --- | ---: | ---: | ---: | ---: |
| Bilinear endpoint | 0.0344170 | 0.0162031 | 0.0214910 | 0.0799010 |
| Global skirt 0.25 | 0.0342012 | 0.0152862 | 0.0230660 | 0.0807690 |
| Global skirt 0.50 | 0.0340775 | 0.0144927 | 0.0247157 | 0.0816734 |
| Global skirt 0.75 | 0.0340164 | 0.0138250 | 0.0264162 | 0.0825994 |
| Ellipse endpoint | 0.0340093 | 0.0132807 | 0.0281367 | 0.0835814 |
| Conditioned skirt 0.50 | 0.0342419 | 0.0156813 | 0.0228115 | 0.0800726 |
| Conditioned skirt 0.75 | 0.0341806 | 0.0154755 | 0.0234715 | 0.0801646 |
| Narrow conditioned 0.75 | 0.0341623 | 0.0154577 | 0.0232739 | 0.0801020 |

Lower is better for every column. The target-aligned underfit metrics measure missing target peaks/gradients rather than rewarding edge quantity alone.

## Verdict

The global skirt curve is a real perceptual trade, not a free improvement. Increasing normal spread monotonically improves RGB MAE and aggregate gradient MAE, while monotonically worsening target-aligned gradient and bright-tail underfit. The final global step from `0.75` to `1.0` improves held-out RGB MAE by only `0.0000071` while target-gradient underfit worsens by about `6.5%`.

Ridge rejection acts consistently across views. At requested mix `0.50`, conditioning improves target-gradient and bright-tail underfit on all 20 held cameras and worsens RGB MAE on all 20. It therefore moves along a stable view-independent structural frontier rather than exploiting one camera. The simple linear conditioner does not dominate every global treatment.

Minor-axis width is useful. Reducing the conditioned `0.75` skirt from unit width to `0.75` improves all four reported metrics relative to the same unit-width conditioned arm. It remains a frontier point rather than a universal scalar winner.

Direct inspection of cameras 0, 10, 15, and 18 agrees with the measurements: global skirts reduce regular stipple but soften the thinnest upward strands; Ridge rejection recovers some filament and peak structure. The page defaults to a composite comparison and supports target-aligned camera traversal, arbitrary left/right treatment selection, residual mode, and an interactive wipe.

This evidence supports a small conditioned footprint head or deterministic calibration surface with explicit structural supervision. It does not justify selecting the ellipse from MAE alone, and it does not include the separately requested grid-96 companion assay.

## Receipts

- Implementation commit: `9ac62cbe`
- Greenroom jobs: `c2d96f6319ac`, `9b4150c1cff4`, `fae4de34a392`, `731b91dc561f`, `b5e17566cbfe`, `81fa710fd788`, `5b6aa162a6c1`, `8a0906a915c8`
- Runner: `/private/tmp/kaminos-mlx-residual-venv/bin/python`
- Backend: NumPy CPU
- Fallback: none
- Timeout: none
- Ignored parameters: none
- Browser witness: `witness/page-witness-report.json`
- Evidence manifest: `evidence-manifest.json`
- Complete artifact hashes: `sha256sums.txt`
