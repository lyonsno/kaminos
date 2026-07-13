# Trellis Control Matrix v1 Pending Jobs

Date: 2026-07-13

Question: can the strongest current imagegen basin, `lirm03-hallucinate-beyond`, be pushed through Trellis with more prior/detail or alternate stochastic resolution while preserving the low armored creature gestalt?

Input: `imagegen-basin-map-v0/lirm03-hallucinate-beyond/output.png`

Existing baseline:

- `imagegen-basin-map-v0/trellis-followthrough/lirm03-hallucinate-beyond-trellis-fast4/output.glb`
- route `trellis2mlx_fast`
- `seed=42`, `steps=4`, `--no-cascade`, `target_faces=200000`, `texture_size=1024`

Pending controls:

| Candidate | Route | Params | Job id |
| --- | --- | --- | --- |
| `lirm03-hallucinate-beyond-fast6-nocascade-s42` | `trellis2mlx_fast` | `seed=42`, `steps=6`, `target_faces=200000`, `texture_size=1024` | `4c877c080de8` |
| `lirm03-hallucinate-beyond-fast4-nocascade-s99` | `trellis2mlx_fast` | `seed=99`, `steps=4`, `target_faces=200000`, `texture_size=1024` | `ff397364a96d` |
| `lirm03-hallucinate-beyond-cascade4-s42` | `trellis2mlx_cascade_steps` | `seed=42`, `steps=4`, `resolution=512`, `target_faces=200000`, `texture_size=1024` | `4914f073a999` |

Expected read: compare against baseline for body-plan retention, shell/leg coherence, disconnected fragments, texture plausibility, and whether cascade adds useful asymmetric structure or destroys the clean low crawler gestalt.
