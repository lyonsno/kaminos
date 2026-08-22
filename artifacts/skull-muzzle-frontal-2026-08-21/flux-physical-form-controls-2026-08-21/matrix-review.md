# Physical-Form Control Atlas Review

Status: all 64 cells complete and directly inspected on 2026-08-21.

## Result

The atlas found four useful, repeatable conditioning basins. Prompt wording
can move this source from furry surface description toward broad physical
construction without sacrificing the horned-canine identity. The strongest
controls describe the physical carrier and how visible markings are embodied;
eye-material adjectives alone are weak controls.

1. **Continuous painted silicone: `81435/04`.** This is the strongest smooth
   reconstruction source. It preserves the long muzzle, tall ears, paired
   horns, amber eyes, asymmetric orange/cream markings, and legible bust
   terminator while expressing the cheeks and ruff as broad attached masses.
   It contains no whiskers or detached thin facial structure.
2. **Connected planar polystone: `81434/09`.** This is the strongest faceted
   reconstruction source. Large interlocking planes describe the muzzle,
   brow, cheeks, and neck without turning the coat into dense plates. The face
   remains specific and readable, and every major part appears physically
   connected.
3. **Rounded polystone masses: `81435/11`.** This is the strongest smooth-volume
   alternate. The coat becomes a small number of attached rounded lobes and
   the facial envelope is exceptionally clean. It carries more identity drift
   than the first two nominees, so it is a shape-basin comparator rather than
   the identity leader.
4. **Enamel/global smoothing: `81434/08`.** This is the clearest diagnostic
   example of the enamel wording changing the whole object's finish and form,
   not merely its eyes. It preserves identity well and suppresses loose coat
   frequency, but the high gloss may be baked into any resulting texture.

## Stable Controls

- `04-silicone-painted-markings` produced a clean continuous carrier in all
  four seeds. Seed `81435` best balances source identity with broad connected
  geometry.
- `09-polystone-connected-facets` produced deliberate connected planar
  construction in all four seeds. Seed `81434` has the best combination of
  coherent part boundaries, facial specificity, and low thin-part pressure.
- `11-polystone-rounded-masses` consistently replaced fur with attached
  rounded volumes. Seed `81435` is the cleanest exact output; the family has
  moderate identity variance around the brows and ruff.
- `08-polystone-enamel-eyes` repeatedly acted as a global gloss and smoothing
  lever. The effect is broader than the prompt's local eye wording.
- `01-silicone-continuous-muzzle` is a strong high-identity alternate. Seeds
  `81433`, `81434`, and `81435` are clean; `81435/01` is the best fallback if
  the painted-markings source proves too stylized in reconstruction.

## Weak Or Unstable Controls

- `05`, `06`, and `07` converge on nearly the same polystone face across three
  independently inspected seeds. The requested inset, painted, or glass eye
  distinction has little leverage over the source geometry. `07` can also
  regrow thin whiskers.
- `02` can preserve useful shallow relief, but whiskers return in multiple
  seeds. It is less reconstruction-friendly than `01` or `04`.
- `03` is semantically unstable: it ranges from useful broad cheek wedges to
  literal lateral spikes.
- `10` and `12` are coherent but over-segment the coat into dense plates or
  locks. Their part count is seed-sensitive and raises unnecessary topology
  pressure.
- `13` reliably interprets puppet language as a clothed full-body character,
  which changes the asset class.
- `14` and `16` can produce clean game/animation maquettes, but they import a
  stronger genre prior and regrow whiskers in some seeds.
- `15` restores naturalistic fur and armor/collar vocabulary and can drift
  toward a fox or tiger-marked canine. It is visually attractive but moves in
  the wrong direction for this reconstruction assay.

## Route And Inventory

Wave two contains 32 unique `512x512` PNG outputs, and all 32 were directly
inspected. Every Greenroom terminal receipt records requested and effective
job type `mflux_flux2_edit_promptfile`, executable
`/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit`,
model `flux2-klein-9b`, quantization 4, eight steps, guidance 1.0, seeds `81434`
or `81435`, and a 48 GB MLX cache limit. All jobs exited zero with no ignored
parameters or backend fallback. Durations range from 52.6 to 106.3 seconds and
average 70.3 seconds. The source remained the exact promoted frontal image with
SHA-256 `6451fcc15a6fc444e63943039229d958a202ae4ebc001addfc9b20bcb4d511d9`.

## Reconstruction Decision

Fire the four exact nominees through the established native MLX TRELLIS
control: resolution 512, eight steps, cascade disabled, 100000 target faces,
512 texture, simplify-first, and one fixed reconstruction seed. This compares
conditioning basins without reopening the completed schedule assay.

The previously completed 12-step-plus-cascade comparison found no useful large
gain over eight-step controls while increasing runtime by 49-52 percent. It is
therefore not repeated here.

## Claim Ceiling

This atlas establishes repeatable image-generation controls and exact source
nominations for matched reconstruction. It does not establish that any source
will improve TRELLIS geometry, repair winding, admit collision or rigging, or
produce a production cast. Those claims require direct multi-angle inspection
of the resulting GLBs.

Call sign: Handy Candyman
