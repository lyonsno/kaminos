# Trellis Guidance-Pressure Assay

## Question

Can the Trellis samplers expose a usable control between source adherence and model-prior invention for creature crucibles? The assay holds the source image, seed, step count, resolution, cascade mode, mesh budget, texture size, and cleanup order fixed while varying guidance at one structural stage at a time.

The fixed source is the multi-reference imagegen hit `prior-shape-0066-preserve-gestalt-clay-depth-normal/output.png` (SHA-256 `03a773c497d03281e94d387d5162058abd9134d6e1c52ecfca1de6ed8193d5ba`). Every heavy generation ran through GPU Greenroom with seed 42, six steps, 512 resolution, no cascade, 200,000 target faces, 1024 texture size, and simplify-first cleanup.

## Verdict

The control exists, but it lives mainly in the sparse structure sampler.

**Sparse-stage pressure controls gross topology and body-plan invention.** Sparse CFG `0.0` crosses into a new organism basin: an upright segmented branch-creature with a transverse sensory or head structure. Sparse CFG `0.25` produces the strongest current inspiration regime: a compact multipart insectoid organism whose silhouette and contact arrangement differ materially from the armored quadruped while retaining some of its visual vocabulary. By sparse CFG `0.5`, the output has already snapped back to the source-conditioned armored quadruped basin. Values from `0.75` through `12.0` preserve that body plan and mainly perturb local structure.

**Dense-stage pressure does not control gross topology in this assay.** Dense Shape SLat CFG `3.0`, `7.5`, and `12.0` all inherit the same 2,440-voxel sparse scaffold and the same armored quadruped gestalt. Increasing dense guidance changes plate articulation, facial elaboration, and cleanup burden. The `3.0` result is visually the cleanest. The `12.0` result shows more facial and plate surface congestion, not a more useful body plan.

The current control law is therefore:

- Use sparse CFG around `0.0` for prior-first body-plan invention with only late positive conditioning.
- Use sparse CFG around `0.25` as the first candidate for scaffold-inspired mutation.
- Use sparse CFG around `0.5` as the observed transition back into source adherence for this source and seed.
- Use sparse CFG `1.0` for ordinary positive-conditioned sampling without classifier-free guidance.
- Use the official sparse CFG `7.5` when source fidelity is the goal.
- Tune dense Shape SLat guidance afterward for local surface adherence and congestion; do not expect it to invent a new silhouette from a fixed sparse scaffold.

This is a one-source, one-seed control assay, so the numerical transition point is provisional. The stage distinction is not provisional: the visual witnesses and intermediate geometry counts both identify sparse structure as the load-bearing body-plan lever.

## Sparse-stage pressure

| Sparse CFG | Sparse voxels | Dense voxels | Raw faces | Final faces | Visible regime |
| ---: | ---: | ---: | ---: | ---: | --- |
| 0.0 | 470 | 178,680 | 369,386 | 193,111 | New upright segmented branch-creature |
| 0.25 | 1,374 | 428,981 | 851,016 | 196,665 | Compact multipart insectoid mutant |
| 0.5 | 2,261 | 873,764 | 1,806,944 | 172,652 | Armored quadruped basin returns |
| 0.75 | 2,168 | 1,317,054 | 2,833,598 | 131,520 | Armored quadruped, rougher local structure |
| 1.0 | 2,220 | 934,896 | 1,922,654 | 175,541 | Positive-conditioned quadruped, no CFG |
| 3.0 | 2,313 | 973,118 | 2,157,940 | 151,177 | Quadruped with local variation |
| 7.5 | 2,440 | 1,419,236 | 2,915,852 | 149,066 | Official-default faithful quadruped |
| 12.0 | 2,538 | 1,223,604 | 2,503,314 | 171,276 | Faithful quadruped with local pressure |

Within the configured guidance interval `t=[0.6, 1.0]`, CFG `0.0` selects the unconditional prediction. Outside that interval the sampler still uses positive conditioning. It is therefore a prior-first hybrid, not an entirely unconditioned generation.

## Dense-stage pressure

| Dense CFG | Sparse voxels | Dense voxels | Raw faces | Final faces | Visible regime |
| ---: | ---: | ---: | ---: | ---: | --- |
| 3.0 | 2,440 | 1,334,723 | 2,694,636 | 173,099 | Same quadruped; cleanest local read |
| 7.5 | 2,440 | 1,419,236 | 2,915,852 | 149,066 | Same quadruped; official default |
| 12.0 | 2,440 | 1,580,373 | 3,385,992 | 103,982 | Same quadruped; plate and facial congestion |

The identical sparse voxel count is the important boundary. Dense-stage guidance only acts after gross occupancy has been chosen.

## Evidence and route identity

- Known-good local runner checked: `/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py`.
- Effective backend: MLX on Apple Silicon, admitted through GPU Greenroom strict FIFO.
- First heavy route proof: generation receipt `3b9a7ce7660e`; the durable receipt manifest records every requested and effective route.
- Heavy run accepted before route proof: no.
- All 11 generation jobs and all 44 admitted witness jobs completed with exit code zero.
- Every generation cell parses its full effective route, rejects duplicate or contradictory load-bearing flags, and binds input, output, seed, steps, resolution, cascade mode, mesh budget, texture size, cleanup order, and both sparse and downstream shape guidance back to the submitted request and fixed assay contract.
- Every generation cell records source hash, requested parameters, effective route, output hash, output size, and parsed geometry metrics in `route-receipts.json`.
- Both contact sheets are assembled deterministically from the 44 admitted witness images named in the route manifest; each cell records its witness job, image hash, stage, pressure, view, and effective camera.
- Dense contact sheet: `dense-shape-guidance-pressure-contact-sheet.png`.
- Sparse contact sheet: `sparse-structure-guidance-pressure-contact-sheet.png`.

The first twelve sparse witness submissions were rejected from the assay. Their CLI used repeated `-p` groups, and the witness route retained only the final group, silently leaving yaw at `0.0`. The admitted witnesses use one `-p` group containing both yaw and pitch. This false-evidence path is recorded in `experiment.json`; none of those invalid views contribute to the contact sheets or route manifest.

## Next experiment

Fan out multiple armature silhouettes at sparse CFG `0.0`, `0.25`, and `0.5`, then vary seed. The discriminator is not prettiness alone. It is whether sparse `0.25` repeatedly preserves a recognizable semantic relation to the source while changing silhouette, gestalt, and locomotion/contact topology enough to populate a selectable creature lineage.
