# Frontal Skull-Muzzle Assay

Operator-authored canonical frontal source plate and downstream image-to-3D assay artifacts.

The authoritative source capture remains adjacent to its Blender sidecar under
`/Users/noahlyons/dev/operator-scratch/source-plates/cat-bauplan-056-strong-weightpaint-operator-v017/`.

## Source

- Capture: `20260821043205043443-felid-skull-front-base.png`
- Source SHA-256: `f02be02a9663da77e2f93d93522ad5452f78ed128c1b54f1ed1c0c1548fea2af`
- Plate: `1024x1024`, perspective viewport, `250 mm` lens
- Visual disposition: canonical frontal, complete and tightly contained skull silhouette; selection edge and centerline discontinuity remain explicit source artifacts to inspect in generated output

## First Completion

- Greenroom job: `be4fad2a78a4`
- Requested route: `mflux_flux2_edit_promptfile`
- Effective generator: `/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit`
- Model: `flux2-klein-9b`, quantization `4`
- Prompt: `Complete this skull into a living animal head.`
- Seed/settings: `81402`, `512x512`, 8 steps, guidance `1.0`, MLX cache limit 48 GB
- Output: `flux-81402/output.png`
- Duration: 35.4 seconds
- Visual disposition: coherent canonical frontal living head with aligned eyes and muzzle; source centerline removed; tall source structures interpreted as pale horns with ears behind them

## Promoted Completion

- Greenroom job: `df7e29bc867c`
- Seed/settings: `81408`, otherwise identical to the first completion
- Duration: 36.5 seconds
- Output: `flux-81408/output.png`
- Visual disposition: promoted TRELLIS source; coherent frontal horned canid/felid head with integrated horns, complete ears, centered muzzle, compact chin/ruff termination, and no visible source centerline artifact

## TRELLIS Seed Comparison

Both jobs used the exact promoted `flux-81408/output.png` source through requested route `trellis2mlx_fast_checkpoint`. The effective route was native MLX `generate.py`, 512 resolution, 8 steps, no cascade, simplify-first, requested target 100000 faces, 512 texture, and checkpoint preservation. No backend or parameter fallback was observed.

### Seed 81408: promoted rough cast

- Greenroom job: `d9762b783887`
- Duration: 270.7 seconds
- Sparse tokens: 4,855
- Decoded voxels: 2,604,114
- Raw geometry: 2,604,114 vertices / 5,105,016 faces
- Export geometry after simplification and cleanup: 106,639 vertices / 199,836 faces
- GLB: `trellis-seed-81408/output.glb`, 12.1 MB
- Visual disposition: facial axis, muzzle projection, ears, horns, and oblique head volume remain coherent. Fine fur becomes crystalline surface noise and horn roots gain extra spike invention. This is the stronger seed and an honest rough cast, not clean production topology.
- Direct route: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Ftrellis-seed-81408%2Foutput.glb`
- Inspected views: `trellis-seed-81408/front.png`, `trellis-seed-81408/oblique.png`

### Seed 81409: useful miss

- Greenroom job: `76825ddaa1fe`
- Duration: 296.5 seconds
- Sparse tokens: 4,390
- Decoded voxels: 3,572,977
- Raw geometry: 3,572,977 vertices / 6,926,072 faces
- Export geometry after simplification and cleanup: 140,423 vertices / 260,540 faces
- GLB: `trellis-seed-81409/output.glb`, 15.5 MB
- Visual disposition: complete unseen back and plausible side silhouette, but the actual front regresses to hollow eyes and weaker facial organization. The first default camera capture faced the inferred back; `front-actual.png` and `oblique-actual.png` record the corrected forward camera.
- Direct route: `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Ftrellis-seed-81409%2Foutput.glb`
- Inspected views: `trellis-seed-81409/front-actual.png`, `trellis-seed-81409/oblique-actual.png`

## Decision

The operator-authored frontal source plate is admitted for this reconstruction campaign without requiring a matched long-muzzle replay. The frontal plate materially improves facial organization relative to the oblique source family, while TRELLIS seed variance remains large. The exact next decision is whether seed 81408 is useful as a bounded crystalline-fur cast or whether the promoted FLUX image should receive one source-side broad-fur-clump cleanup pass before another TRELLIS seed. Long-muzzle parity remains optional causal-analysis work, not a prerequisite for the asset route.
