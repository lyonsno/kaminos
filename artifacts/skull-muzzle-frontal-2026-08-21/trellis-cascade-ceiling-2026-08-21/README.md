# TRELLIS Cascade Ceiling Assay

This is a two-cell comparison requested by the operator. It measures the large
delta from each source's existing eight-step, cascade-disabled control to a
twelve-step, cascade-enabled firing. It is not an 8/10/12 staircase.

Both new cells use the native MLX `trellis2mlx_cascade_steps` Greenroom route,
TRELLIS seed parity with the corresponding promoted control, resolution 512,
100000 target faces, 512 texture, and simplify-first. Cascade is enabled by the
native pipeline default; the effective command must not contain
`--no-cascade`. Holding mesh and texture presentation settings fixed keeps the
assay focused on diffusion steps plus the cascade pass.

## Cells

- `feature-animation-81412/trellis-81414-steps12-cascade`: source seed 81412,
  TRELLIS seed 81414. Control: Greenroom job `da74d654295c` at eight steps with
  cascade disabled.
- `identity-hybrid-81416/trellis-81421-steps12-cascade`: source seed 81416,
  TRELLIS seed 81421. Control: Greenroom job `5dfac5a7b3a0` at eight steps with
  cascade disabled.

## Claim Ceiling

The pair can show whether the larger schedule plus cascade visibly improves,
preserves, or degrades these two already-productive conditioning basins on the
current native MLX route. It cannot separate the causal contribution of step
count from cascade, establish CUDA parity, establish general TRELLIS behavior,
or admit production topology without visual orbit inspection.

Greenroom completion proves only that the effective command terminated. Each
GLB remains unpromoted until it has been loaded through the Kaminos single-asset
viewer and inspected against its source and eight-step control.
