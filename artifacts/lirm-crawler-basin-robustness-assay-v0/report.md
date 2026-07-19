# LIRM Crawler Basin Robustness Assay v0

## Decision

The fixed 13-parameter crawler SDF program recovered all four precommitted donors in one low-crawler topology family. Each donor improved silhouette IoU on all four held-out diagonal cameras and improved mean held-out depth MAE. The aggregate 3-of-4 basin predicate therefore passed at 4-of-4, and both aggregate witnesses were visually inspected and accepted.

This is evidence that reference fitting is a reusable within-basin control surface rather than a one-donor reconstruction trick. It does not establish transfer to a second topology family or recovery of donor-specific appendages and surface segmentation.

## Frozen Contract

- Donors were frozen before fit outcomes were observed in [`manifest.json`](./manifest.json).
- Donor replacement was forbidden.
- The route remained `kaminos/reference-fitted-armature/software-glb-raster-plus-sdf-fit-v0`.
- One reviewed 13-parameter SDF crawler vocabulary and one initialization were used for every donor.
- Four cardinal cameras were fit views; four diagonal cameras were held out.
- Donor recovery required silhouette improvement on at least three held-out views plus improved mean held-out depth MAE.
- Basin recovery required at least three of four donors.

## Results

| Frozen donor | Held-out silhouette IoU | Held-out depth MAE | Improved silhouette views | Bound pressure |
| --- | ---: | ---: | ---: | --- |
| `basin-03-preserve` | 0.6093 -> 0.7647 | 0.04714 -> 0.03509 | 4/4 | none |
| `basin-10-lineage` | 0.5577 -> 0.7862 | 0.06175 -> 0.04114 | 4/4 | none |
| `basin-15-lineage` | 0.5877 -> 0.7685 | 0.04018 -> 0.03207 | 4/4 | `curveAmplitude` at lower bound |
| `basin-22-lineage-control` | 0.6982 -> 0.8027 | 0.03902 -> 0.02729 | 4/4 | none |

Latest full-matrix runtime was 39.011 seconds under live machine contention. An earlier equivalent run completed in 25.033 seconds, so this slice establishes assay-scale latency rather than a clean benchmark.

## Visual Inspection

- [Aggregate silhouette witness](./comparison-witness.png), SHA-256 `9650a3645eb87586b5757285671faf46a16e7d579a00297fca9d3a0d6c948f75`
- [Aggregate depth witness](./depth-comparison-witness.png), SHA-256 `c2733cee4641f12f05e5bb52706afeaa131af73af8c488773e11a9a8448ed9df`
- [Machine-readable report](./report.json)

Across all four donors, the fitted body visibly approaches donor length, lateral and vertical mass, posterior taper, stance, and coarse contact footprint in all eight camera rows. The diagonal rows show that the improvement survives outside the views used by the optimizer.

The residuals are also legible. Donor-specific appendages, shell segmentation, and the `basin-03-preserve` anterior tube remain outside the current vocabulary. `basin-15-lineage` pushed `curveAmplitude` to zero, which is a useful local pressure signal but did not prevent held-out recovery.

## Next Decision Boundary

Test a second curated topology family with the same freeze-first discipline before adding crawler-specific parameters. A second-family pass would establish that a small atlas of fitted morphology programs is viable. A second-family miss would locate whether the next investment belongs in family selection, initialization, or a broader semantic vocabulary. Expanding this crawler now would improve known residuals while leaving the higher-leverage cross-basin question unanswered.
