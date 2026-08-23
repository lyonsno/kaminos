# TRELLIS high-resolution assay

This four-cell assay compares two already-promising skull-muzzle conditioning
images at 768 and 1024 inference resolution. Every cell used the native MLX
`trellis2mlx_checkpoint` route, eight steps, cascade enabled, seed-stable input,
a 100,000 target-face request, 4096 texture size, and simplify-first cleanup.

| Source class | Seed | Resolution | Runtime | Output |
| --- | ---: | ---: | ---: | --- |
| Strong identity hybrid | 81421 | 768 | 370.1 s | `strong-identity-hybrid-81416/trellis-81421-r768/output.glb` |
| Strong identity hybrid | 81421 | 1024 | 1075.7 s | `strong-identity-hybrid-81416/trellis-81421-r1024/output.glb` |
| Moderate faceted | 81414 | 768 | 757.2 s | `moderate-faceted-81413/trellis-81414-r768/output.glb` |
| Moderate faceted | 81414 | 1024 | 2395.4 s | `moderate-faceted-81413/trellis-81414-r1024/output.glb` |

The paired comparison is not a clean estimate of resolution alone: this route
requires cascade for 768 and 1024, while the earlier 512 runs did not use it.
The texture-size request is also downstream of geometry inference. The observed
results do not show monotonic improvement at 1024, so neither higher resolution
nor cascade is promoted as a general quality lever from this assay.

The operator inspection surfaces are:

- `../operator-day-image-browser-2026-08-22/spatial.html` for all skull casts.
- `../operator-day-image-browser-2026-08-22/cross-family.html` for these four
  casts beside full-body organic, Pixal9, and Gribble controls.

Claim ceiling: matched within-source high-resolution cascade response and
bounded static visual orbitability. These artifacts do not establish topology,
winding, collision, rigging, animation, anatomical fidelity, CUDA parity, or
production suitability.
