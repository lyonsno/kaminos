# Trellis Control Matrix v1 Report

Date: 2026-07-13

## Question

Given the same strong Flux2 creature image (`imagegen-basin-map-v0/lirm03-hallucinate-beyond/output.png`), which Trellis decode setting is the best near-term followthrough route?

Controls:

- baseline `fast4 / no cascade / seed 42`;
- `fast6 / no cascade / seed 42`;
- `fast4 / no cascade / seed 99`;
- `cascade4 / seed 42`.

## Route

Visual witness:

- `trellis-control-contact-sheet.html`
- `trellis-control-contact-sheet.png`

All control outputs use `target_faces=200000`, `texture_size=1024`, `resolution=512`.

## Jobs

| Candidate | Route | Job id | Output |
| --- | --- | --- | --- |
| baseline fast4 / no cascade / seed 42 | previous followthrough | previous slice | `../imagegen-basin-map-v0/trellis-followthrough/lirm03-hallucinate-beyond-trellis-fast4/output.glb` |
| fast6 / no cascade / seed 42 | `trellis2mlx_fast` | `4c877c080de8` | `lirm03-hallucinate-beyond-fast6-nocascade-s42/output.glb` |
| fast4 / no cascade / seed 99 | `trellis2mlx_fast` | `ff397364a96d` | `lirm03-hallucinate-beyond-fast4-nocascade-s99/output.glb` |
| cascade4 / seed 42 | `trellis2mlx_cascade_steps` | `4914f073a999` | `lirm03-hallucinate-beyond-cascade4-s42/output.glb` |

## Timing

Greenroom receipt durations:

- `fast6 / no cascade / seed 42`: about 116 seconds.
- `fast4 / no cascade / seed 99`: about 96 seconds.
- `cascade4 / seed 42`: about 96 seconds.

The baseline fast4 came from the previous slice and is retained as the visual anchor.

## Visual Read

The baseline fast4 remains a credible route: it preserves the armored crawler body and gives a coherent enough mesh for exploration.

`fast6 / no cascade / seed 42` is the most attractive control in this sheet. It reads cleaner and more developed than baseline, with stronger shell/body mass and better visible limb/contact structure. It changes the body enough to be useful rather than merely polishing the baseline.

`fast4 / no cascade / seed 99` is also useful. It changes morphology without collapsing the creature class, which is good evidence that seed exploration is meaningful for this basin.

`cascade4 / seed 42` is the weakest of the four for this input. It has more ragged surface and less attractive body coherence in the shared view. Cascade may still matter for other inputs, but this particular creature basin does not justify making cascade the default.

## Takeaway

For LIRM creature followthrough, keep `fast4 / no cascade` as the cheap baseline, but try `fast6 / no cascade` when an image candidate is promising. The extra steps appear to buy useful body development at a modest time cost. Seed variation is also worth sampling because it changes the creature without losing the basin.

Do not promote cascade as the default for this flow based on this evidence.

## Next Slice

Use `fast4` for broader image basin screening, `fast6` for promising candidates, and occasional seed variation when a source image is visually strong. If a candidate is meant to become a hero creature, compare at least one `fast6` and one seed variant before judging the basin.
