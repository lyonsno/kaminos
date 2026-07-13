# Imagegen Control Matrix v1 Jobs

Date: 2026-07-13

Question: does prompt stance let Flux2 choose between scaffold adherence and model-prior anatomical invention while preserving crude LIRM armature identity?

Route: `mflux_flux2_edit_promptfile`

Common params: `model=flux2-klein-9b`, `quantize=4`, `width=512`, `height=512`, `steps=8`, `guidance=1.0`, `mlx_cache_limit_gb=48`

| Candidate | Stance | Seed | Final job id | Input |
| --- | --- | ---: | --- | --- |
| `lirm02-invent-anatomy` | model-prior anatomy completion | 4202 | `249118a2bbd3` | `conditioning-packages/lirm-armature-02/trellis-source.png` |
| `lirm02-preserve-silhouette` | strict silhouette preservation | 4202 | `7b5486eae1fe` | `conditioning-packages/lirm-armature-02/trellis-source.png` |
| `lirm03-invent-anatomy` | model-prior anatomy completion | 4203 | `dbdbaf174642` | `conditioning-packages/lirm-armature-03/trellis-source.png` |
| `lirm03-preserve-silhouette` | strict silhouette preservation | 4203 | `80caab5f16c5` | `conditioning-packages/lirm-armature-03/trellis-source.png` |
| `lirm07-invent-anatomy` | model-prior anatomy completion | 4207 | `68087ddec5ec` | `conditioning-packages/lirm-armature-07/trellis-source.png` |
| `lirm07-preserve-silhouette` | strict silhouette preservation | 4207 | `5362eab34135` | `conditioning-packages/lirm-armature-07/trellis-source.png` |

Expected read: compare each pair for silhouette preservation, anatomical invention, eye/mouth attractor strength, and whether the output remains a single mesh-worthy creature.

## Superseded First Attempts

The first submissions for the final four rows (`09ec93deced9`, `5a34c545c7de`, `d4676b43748a`, `8d2f4b0b9794`) exited `0` but produced no primary image because their prompt files were absent at execution time. See `report.md` for the route-evidence warning and visual read.
