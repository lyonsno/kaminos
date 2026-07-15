# Held Field Smoke Tomography V1

## Claim Under Test

The broad F smoke-authority slab is primarily a projection or optical-transfer
failure, while the checksum-bound r160 source still contains a compact,
semantically useful mature plume at a threshold that preserves most smoke
extinction.

## Falsifying Observation

Exact 3D occupancy remains domain-filling across thresholds that preserve most
extinction. A compact support appears only after discarding the overwhelming
majority of source extinction.

## Falsifier Competence Floor

- Exact held manifest SHA-256:
  `553fc56d90ce13309595e8856ce0d54a87800d0b57e4476ea8fc847748149afa`.
- Exact fluid SHA-256:
  `9a3cc037648b05de94197ec3d3451a0f8986ac3360b3379de374a1b409feda20`.
- Full `160^3` grid and all `4,096,000` smoke-density samples are processed.
- Requested and effective thresholds are identical; no threshold cap,
  subsampling, truncation, fallback, or cached projection is admitted.
- Every row records retained extinction, occupied 3D support, grid/world bounds,
  boundary-shell contact, and exact XY/XZ/YZ occupancy masks.
- PNG rows follow thresholds
  `0, 1e-6, .001, .01, .05, .1, .25, .5, 1, 1.25, 1.5, 1.7`; columns are
  XY, XZ, and YZ.

## Result

- At exact positive density, `4,058,593 / 4,096,000` voxels (`99.09%`) are
  occupied and projected support covers `99.37-100%` of every orthographic
  plane.
- The prior browser statistic is reproduced exactly at threshold `1e-6`:
  `3,900,122` occupied voxels (`95.22%`). That row retains more than
  `99.999999%` of extinction and still covers `97.90-100%` of the projections.
- At threshold `.1`, the source remains `57.87%` occupied, retains `98.18%` of
  extinction, and covers `77.78-84.78%` of the projections.
- At threshold `.5`, the source remains `44.08%` occupied, retains `89.27%` of
  extinction, and covers `65.61-70.99%` of the projections.
- Threshold `1.25` begins to expose visibly articulated support, but retains
  only `8.98%` of extinction. Threshold `1.5` retains `1.72%`; threshold `1.7`
  retains `0.35%`.

## Disposition

The claim is falsified. The broad F slab is source-backed: this evolved held
state is globally smoke-filled, not a compact plume hidden by beauty lighting
or one bad camera projection. Thresholding cannot rescue it as a physical
teacher without deleting most of the field's extinction and changing the
semantic object under test.

Keep this basin as a static saturation and stress source. Exclude it from
temporal-teacher custody. The next temporal experiment must use the fresh,
camera-bearing r160 tall-plume window selected in the Handy-to-oracle directive.

## Artifacts

- `tomography-report.json`: machine-readable source identity, full threshold
  accounting, bounds, slice populations, and projection support.
- `tomography.png`: visually inspected exact occupancy masks, ordered as
  described above.
