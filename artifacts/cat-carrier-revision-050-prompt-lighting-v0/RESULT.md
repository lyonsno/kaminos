# Revision-050 prompt and lighting result

## Campaign state

The revision-050 authored carrier now has a compact prompt basin that produces
substantial living anatomical elaboration while retaining the authored body as
the dominant source of silhouette and proportion. The successful instruction
is not a longer completion prompt. It is the five-word material operation:

> This shape covered in skin.

That transition repeated at seeds `80301` and `80302`. Both outputs resolve the
carrier into plausible living quadrupeds with skin, muscle mass, feet, face,
and limb continuity while preserving the source's trunk, neck, hindquarter,
stance, and tail authority. This is the strongest minimal biological
completion basin observed for this source.

## What changed

The generic ladder is categorical rather than a smooth elaboration control.

- `Creature.` and `Complete this creature.` mostly reproduce the gray carrier
  without supplying a living surface.
- `This shape as a creature.` can perturb stance and feet without buying useful
  biological completion.
- `This shape covered in skin.` crosses into coherent living anatomy without
  wholesale redesign.
- `Elaborate this shape into a finished creature.` preserves the carrier but
  tends toward a faceted wooden or low-poly physical-model interpretation.
- Adding `richly detailed` crosses a second boundary: both seeds surrender
  substantial authored authority to ornate horned fantasy-creature priors.

The immediate program consequence is that prompt length is not the relevant
knob. Concrete surface language can activate a useful completion operation;
generic completion language can do almost nothing; decorative intensifiers can
replace rather than refine the authored solution.

The lighting suffixes also worked, with an important qualification. `Even
diffuse studio lighting`, `Raking side lighting`, and `Soft rim light with
frontal fill` all retained the same scaly horned-creature basin at fixed source,
seed, and base prompt while materially changing illumination and background.
They are controlled enough to probe Trellis lighting sensitivity, but they are
not pure relights: framing and some local shape interpretation move as well.

Finally, literal 3D construction language repaired the stone target. `thick
overlapping weathered stone slabs` produced visibly thick, separated,
overlapping masses rather than relying on cracks and moss to imply a stone
surface. That output is a cleaner test of whether the earlier disappointing
golem reconstruction came from Trellis or from an ambiguous FLUX plate.

## Next composition

Promote five outputs to Trellis while reusing the existing neutral-dragon cast
as the lighting control:

1. Both `This shape covered in skin.` seeds, to test whether the minimal
   biological basin reconstructs consistently rather than only looking good in
   2D.
2. The thick-overlapping-stone-slabs diagnostic, to isolate input construction
   clarity from Trellis's stone-mesh behavior.
3. The even-diffuse and raking-side dragon variants, to bracket low-shadow and
   high-shadow reconstruction against the already-cast neutral dragon.

Do not promote the richly detailed cells: they answer the prompt-authority
question by visibly abandoning too much of the carrier. The `finished
creature` cells remain useful evidence about the physical-model basin, but an
additional cast there would duplicate earlier maquette work rather than reduce
the current uncertainty.

## Trellis continuation result

All five selected outputs completed through `trellis2mlx_fast` and were
inspected across the source plate plus six orbit views per cast.

The thick-overlapping-stone source is the clearest causal result. Its hidden
and rear views remain organized as a large rigid system of thick overlapping
parts rather than collapsing into a smooth quadruped with crack graphics
painted onto it. Trellis simplifies and locally reinterprets some slab
boundaries, so this is not part-by-part identity preservation. It does show
that literal thickness, separation, and overlap in the FLUX plate can cross a
useful threshold into volumetric construction-class evidence.

Both skin casts reconstruct as coherent living quadrupeds rather than reverting
to the authored low-poly carrier. This admits the compact skin prompt as a
usable 2D-to-3D biological completion route for these exact two seeds, while
leaving quantitative registration against the source skeleton to the operator's
Blender comparison.

The diffuse and raking dragon casts both retain the same broad horned-creature
basin, but their orbit views differ materially in horn arrangement, dorsal
spines, limb construction, and local body mass. The lighting clauses therefore
cannot be treated as rendering-only perturbations: lighting evidence in the 2D
plate changes reconstructed geometry. This is useful control authority, but it
must be modeled as a coupled appearance-and-geometry intervention.

The immediate program update is positive but bounded. Explicit construction
language can improve the 3D structural prior supplied to Trellis, while modest
2D illumination changes can alter the inferred object itself. Future Trellis
comparisons should freeze illumination whenever geometry is the dependent
variable, and should vary illumination deliberately when reconstruction
sensitivity is the object of study.

## Claim ceiling

This campaign establishes the prompt transitions for one exact revision-050
source, one FLUX route/configuration, two seeds for the generic ladder, and five
visually inspected Trellis continuations. It does not establish a universal
prompt grammar, production reliability, part identity, or 3D registration.
Operator registration against the massaged skeleton remains a separate evidence
tier.

## Audit appendix

- Visual sheet: `prompt-lighting-sheet.html`
- Trellis visual sheet: `prompt-lighting-trellis-sheet.html`
- Immutable campaign contract: `campaign.json`
- Route-bearing result ledger: `result-ledger.json`
- Trellis route-bearing result ledger: `trellis-result-ledger.json`
- FLUX route: `flux2-klein-9b`, quantization `4`, `512x512`, eight steps,
  guidance `1.0`, MLX cache limit `48 GiB`
- Trellis route: `trellis2mlx_fast`, seed `42`, six steps, `200000` target
  faces, `1024` texture
- Authored source SHA-256:
  `ef0e51a852abe8796f8e8c593911a08f4867940ad720f41fbbe6fb8127aee633`
- Every result cell records requested and effective route/config identity,
  prompt bytes, output hash, and copied Greenroom receipts.
