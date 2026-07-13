# Imagegen Control Matrix v1 Report

Date: 2026-07-13

## Question

Can Flux2 be steered between two useful regimes from crude LIRM SDF/armature control renders?

- `invent anatomy`: preserve broad body-plan cues while letting the image model complete missing creature structure from its prior.
- `preserve silhouette`: hold the scaffold much tighter and mainly elaborate surface/material/anatomical texture.

## Route

Route: `mflux_flux2_edit_promptfile`

Common parameters: `model=flux2-klein-9b`, `quantize=4`, `width=512`, `height=512`, `steps=8`, `guidance=1.0`, `mlx_cache_limit_gb=48`.

Inputs:

- `conditioning-packages/lirm-armature-02/trellis-source.png`
- `conditioning-packages/lirm-armature-03/trellis-source.png`
- `conditioning-packages/lirm-armature-07/trellis-source.png`

Visual witness:

- `contact-sheet.png`

## Jobs

| Candidate | Stance | Seed | Final job id | Output |
| --- | --- | ---: | --- | --- |
| `lirm02-invent-anatomy` | model-prior anatomy completion | 4202 | `249118a2bbd3` | `lirm02-invent-anatomy/output.png` |
| `lirm02-preserve-silhouette` | strict silhouette preservation | 4202 | `7b5486eae1fe` | `lirm02-preserve-silhouette/output.png` |
| `lirm03-invent-anatomy` | model-prior anatomy completion | 4203 | `dbdbaf174642` | `lirm03-invent-anatomy/output.png` |
| `lirm03-preserve-silhouette` | strict silhouette preservation | 4203 | `80caab5f16c5` | `lirm03-preserve-silhouette/output.png` |
| `lirm07-invent-anatomy` | model-prior anatomy completion | 4207 | `68087ddec5ec` | `lirm07-invent-anatomy/output.png` |
| `lirm07-preserve-silhouette` | strict silhouette preservation | 4207 | `5362eab34135` | `lirm07-preserve-silhouette/output.png` |

## Route Evidence Warning

The first submission of the last four cells (`09ec93deced9`, `5a34c545c7de`, `d4676b43748a`, `8d2f4b0b9794`) produced `exit_code: 0` receipts but no `output.png`. The stdout for each said the prompt file did not exist, and the generated `metadata.json` recorded `output_files: []`.

Those receipts are nominal-success/primary-output-missing failures. They were not treated as valid evidence. The prompt files were restored and the four cells were rerun as the final jobs above.

## Visual Read

This is a strong positive result for controllable creature-armature firings.

The `invent anatomy` prompts consistently let Flux2 ride its organism prior harder:

- `lirm02-invent-anatomy` becomes a heavy quadrupedal grub with clear front mouth, limb/contact structure, surface pores, and a readable creature gestalt.
- `lirm03-invent-anatomy` becomes the strongest image cell: a low armored crawler with shell ridge, head, teeth/mouth structure, side limbs, and a coherent production-friendly object read.
- `lirm07-invent-anatomy` becomes a bulky segmented crawler with many retained LIRM-ish body cues and a more creature-like anatomy than the scaffold alone.

The `preserve silhouette` prompts do the complementary job:

- `lirm02-preserve-silhouette` keeps the comma/larval curve and stays closer to the source armature.
- `lirm03-preserve-silhouette` keeps a low broad segmented scuttler body while still adding material and anatomy.
- `lirm07-preserve-silhouette` keeps the swollen segmented body and floating-larva read but is less mesh-ready than the invent variant.

The main failure mode is that the model can create eye-coded/head-coded structures too eagerly, and can make familiar animal mouths when asked for terminal mouth structure. That is currently acceptable because we are trying to learn how to expose the body-plan prior, not yet lock final LIRM identity.

## Takeaway

The lever works. Prompt stance plus crude 3D control render is enough to choose between:

- scaffold-adherent silhouette preservation;
- model-prior anatomical completion.

For near-term basin exploration, `invent anatomy` is higher leverage. For later species continuity and mesh followthrough, keep `preserve silhouette` as a control and use it when the body plan is already good.

## Next Slice

Use `lirm03-invent-anatomy` and `lirm07-invent-anatomy` as the next image-to-3D candidates. For the procedural armature side, increase variation in silhouette and gestalt before spending more image runs: body height, head/front mass, shell/back plate shape, contact footprint, limb count, and asymmetry pressure.
