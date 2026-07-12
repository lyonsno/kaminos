# LIRM Speciation Armature Imagegen Basin Map v0

Date: 2026-07-12

## Question

Can crude but actual 3D-ish LIRM armature renders drive local image generation into useful creature basins, and do those image outputs remain useful enough for cheap Trellis follow-through?

## Inputs

Three diverse armature renders from the gestalt assay were used:

- `lirm-armature-02/trellis-source.png`
- `lirm-armature-03/trellis-source.png`
- `lirm-armature-07/trellis-source.png`

Each received two prompt stances:

- `match-scaffold`: preserve the visible scaffold and make it plausible as a living creature.
- `hallucinate-beyond`: use the scaffold as a body-plan seed and let the model invent missing anatomy.

## Flux2 Edit Route

Job type: `mflux_flux2_edit_promptfile`

Effective command family:

```text
mflux-generate-flux2-edit --image-paths <armature> --prompt-file <prompt.txt> --output output.png --metadata --model flux2-klein-9b --quantize 4 --height 512 --width 512 --steps 8 --guidance 1.0 --seed <seed> --mlx-cache-limit-gb 48
```

Job receipts:

| Output | Job id | Seed | Duration |
| --- | --- | ---: | ---: |
| `lirm02-match-scaffold/output.png` | `a29eb5f9bce4` | 4202 | 118.1s |
| `lirm02-hallucinate-beyond/output.png` | `0d7ee3bf325a` | 4202 | 106.3s |
| `lirm03-match-scaffold/output.png` | `969838ec7803` | 4203 | 93.3s |
| `lirm03-hallucinate-beyond/output.png` | `53cfcc938c34` | 4203 | 66.0s |
| `lirm07-match-scaffold/output.png` | `0f9ad7921563` | 4207 | 56.5s |
| `lirm07-hallucinate-beyond/output.png` | `13ec19d2a4cf` | 4207 | 76.5s |

Visual witness:

- `contact-sheet.png`

## Flux2 Visual Read

All six outputs were visually healthy and materially scaffold-responsive.

`lirm02-match-scaffold` stayed close to the source: clean segmented grub, preserved curve, mouth/front readability, believable object. `lirm02-hallucinate-beyond` added mass, feet, pores, folds, and a better creature posture without losing the family.

`lirm03-match-scaffold` produced a low armored arthropod/object hybrid, visually coherent and close to the side-plate scaffold. `lirm03-hallucinate-beyond` is the strongest image: an armored grub / trilobite-like creature with legs, face pressure, shell plates, and enough gestalt that it should remain worth routing.

`lirm07-match-scaffold` produced a coherent but less clean tadpole-pouch creature and also introduced a floating sphere/egg, which is a useful failure signal. `lirm07-hallucinate-beyond` is charming and coherent, but the eye/mouth attractor is strong and pushes it toward cute creature illustration.

Takeaway: the prompt stance is a real control handle. `hallucinate-beyond` does what we wanted for crude armatures: it lets the model ride its prior while preserving enough scaffold to remain a directed experiment.

## Trellis Follow-Through Route

The three `hallucinate-beyond` images were routed through cheap Trellis.

Job type: `trellis2mlx_fast`

Effective command family:

```text
generate.py --image <output.png> --output output.glb --seed 42 --resolution 512 --steps 4 --no-cascade --target-faces 200000 --texture-size 1024 --simplify-first
```

Job receipts:

| Output | Job id | Duration | Size |
| --- | --- | ---: | ---: |
| `trellis-followthrough/lirm02-hallucinate-beyond-trellis-fast4/output.glb` | `c5d3a99b810c` | 64.0s | 8.9M |
| `trellis-followthrough/lirm03-hallucinate-beyond-trellis-fast4/output.glb` | `e07c415ddfbc` | 65.6s | 8.5M |
| `trellis-followthrough/lirm07-hallucinate-beyond-trellis-fast4/output.glb` | `95dfae58d27a` | 65.9s | 8.8M |

Visual witnesses:

- `trellis-followthrough-contact-sheet.html`
- `trellis-followthrough-contact-sheet.png`

## Trellis Visual Read

The Trellis route produced three loadable meshes, and the screenshot witness confirms they render.

`lirm03` is the useful follow-through hit. It preserved enough armored arthropod gestalt to count as a valid basin continuation: low body, shell plates, side segmentation, leg pressure, and creature silhouette.

`lirm02` and `lirm07` confirm the basin is live, but also show current failure modes. `lirm02` has disconnected or over-separated blob forms and reads like two creature masses fighting for custody. `lirm07` keeps a coherent creature idea, but the eye/mouth attractor dominates and produces a cuter, more literal cartoon-creature topology.

This is still a strong result for fast4/no-cascade. The failure mode is useful because it says what to tune next: source silhouette/gestalt diversity and Trellis prior/adherence controls, not more prompt thrashing alone.

## Generator Controls

### Flux2 Edit

Current real levers:

- `prompt stance`: strongest lever seen so far. `match-scaffold` versus `hallucinate-beyond` changes whether the model obeys or invents.
- `conditioning image`: likely the next strongest lever. We have only tested a single `trellis-source.png` render per armature here.
- `steps`: currently 8. This is probably worth probing at 4, 6, 8, and 12 for speed/coherence tradeoff.
- `seed`: basin exploration.
- `width` / `height`: quality/crop/detail lever; keep 512 for current basin mapping.
- `model`: current route used `flux2-klein-9b`; Greenroom also exposes edit model names in the backing server, but route identity should be smoked before treating model variants as equivalent.
- `quantize`: speed/memory/quality lever, probably not the first conditioning/adherence lever.

Non-lever on this route:

- `guidance`: the backing `Flux2KleinBackedModel` only supports `guidance=1.0` and coerces other values to 1.0.

Missing on this route:

- no explicit `conditioning_strength`, `image_strength`, `denoise`, or ControlNet-style strength parameter is exposed by `mflux_flux2_edit_promptfile`.

Adjacent route:

- `mflux_img2img` exposes `image_strength` with default `0.56`, but it is currently a different Greenroom route/model family (`z-image-turbo` default). This is a real condition-versus-inspiration lever, but it should be treated as a separate generator basin, not a Flux2 edit knob.

### Trellis

Current real levers:

- `steps`: likely the strongest cheap lever for how much the model elaborates versus follows the input.
- `cascade`: this fast route uses `--no-cascade`; prior gribble-box work suggested cascades can restore asymmetric/detail-rich elaboration.
- `route`: `trellis2mlx_fast` versus `trellis2_official_512_seeded` is a major route-family lever while the local port remains under repair.
- `target_faces`: output detail/storage lever, not a first-order prior/adherence lever at this stage.
- `texture_size`: texture/readability lever, not a first-order prior/adherence lever.
- `seed`: stochastic basin exploration.
- `resolution`: route-dependent; worth revisiting after candidate basins are stronger.

## Recommended Next Slice

1. Keep `lirm03-hallucinate-beyond` as the current positive seed.
2. Run a small Trellis route matrix on it:
   - fast no-cascade, `steps=4`;
   - fast no-cascade, `steps=6`;
   - cascade/official route if available at comparable texture size;
   - one alternate seed.
3. Run a Flux2 edit mini-matrix over the same three armatures:
   - current `hallucinate-beyond`;
   - a stronger “invent anatomy beyond scaffold” prompt;
   - a weaker “preserve silhouette, elaborate surface” prompt;
   - optional 6-step probe for speed.
4. Add a basin registry file for prompt stance, conditioning image type, seed, model route, and visual verdict so we can start predicting which language/conditioning combinations hit good basins.

Current verdict: live enough to keep pushing. The creature armature flow is no longer speculative; it produced directed, aesthetically usable images and at least one plausible Trellis follow-through from crude procedural body seeds.
