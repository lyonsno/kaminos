# Wave One Visual Review

Wave one fired all ten prompts at matched seeds `81410` and `81411`. All 20 jobs completed through Greenroom `mflux_flux2_edit_promptfile` with the requested `flux2-klein-9b` Q4 route, `512x512`, 8 steps, guidance 1.0, and the intended per-cell seed. Per-image execution ranged from 45.2s to 67.4s, averaging 56.0s. No blank, partial, missing, cached-looking, fallback, or failed output was observed.

## Ranking

1. **`04-faceted-fur-planes` - leading reconstruction-source basin.** Both seeds remain volumetric and frontal, preserve two horns, readable ear bowls, eyes, muzzle, and a complete head terminator, and reorganize the coat into visibly broader surface planes. Seed `81411` expresses the intervention most clearly. Phenotype drift toward a deer/canid hybrid is present but moderate.
2. **`08-feature-animation` - strongest coherent simplification extreme.** Both seeds produce clean rounded volumes and broad clumps with clear depth cues. Style intensity and expression vary, and identity drift is substantial, but this is the cleanest stable test of whether the current TRELLIS route benefits from low-frequency source structure.
3. **`06-smooth-skin-sparse-tufts` - cleanest facial-geometry diagnostic.** Both seeds remove most facial fur and expose excellent lids, muzzle, nostrils, horn roots, and ear structure. Material and phenotype are unstable, including blue-gray skin in seed `81411`, and both retain a fibrous neck ruff. Use as a diagnostic extreme rather than an identity-faithful candidate.
4. **`07-naturalistic-stylization` - identity-preserving control.** Both seeds remain close to the promoted source and preserve coherent volume, but fine fur frequency is only mildly reduced. Useful as a fidelity-side comparison, not a leading cleanup.
5. **`10-adventure-game` - attractive but dimensionally unstable.** Seed `81410` is an excellent broad-clump, hand-painted volumetric result; seed `81411` collapses toward a flat illustration. Preserve the good miss and use the second wave to estimate how often this prompt reaches the useful basin.
6. **`03-smooth-close-coat` - clean central face, hostile perimeter.** Both seeds smooth the muzzle and forehead, but retain or expand long fine hair around the ears, ruff, and neck; seed `81411` also changes the head terminator into a larger bust.
7. **`09-soft-cel-shading` - stable flat-image basin.** Both seeds create clean readable shapes but remove too much volumetric shading. Useful only as an extreme test of whether TRELLIS hallucinates volume from semantic shape; not promoted as the likely asset route.
8. **`05-lifelike-maquette` - carved-relief miss.** Both seeds replace photoreal fur with dense sculpted relief rather than broad masses, and lighting/material behavior varies strongly. The intervention does not reduce geometric frequency enough.
9. **`01-directional-tufts` - stable negative.** Both seeds lengthen the coat into many thin directional strands and increase eye occlusion.
10. **`02-layered-masses` - strongest stable negative.** Both seeds produce long layered hair that obscures the brow and eyes. The word `masses` did not cause broad low-frequency grouping on this source.

## Direct Images

- Leading basin: [`04` seed 81410](wave-1/seed-81410/04-faceted-fur-planes/output.png), [`04` seed 81411](wave-1/seed-81411/04-faceted-fur-planes/output.png)
- Clean simplification extreme: [`08` seed 81410](wave-1/seed-81410/08-feature-animation/output.png), [`08` seed 81411](wave-1/seed-81411/08-feature-animation/output.png)
- Smooth-face diagnostic: [`06` seed 81410](wave-1/seed-81410/06-smooth-skin-sparse-tufts/output.png), [`06` seed 81411](wave-1/seed-81411/06-smooth-skin-sparse-tufts/output.png)
- Identity-side control: [`07` seed 81410](wave-1/seed-81410/07-naturalistic-stylization/output.png), [`07` seed 81411](wave-1/seed-81411/07-naturalistic-stylization/output.png)
- Unstable attractive basin: [`10` seed 81410](wave-1/seed-81410/10-adventure-game/output.png), [`10` seed 81411](wave-1/seed-81411/10-adventure-game/output.png)

## Decision Boundary

Wave two is already queued at seeds `81412` and `81413`. If `04` stays volumetric and broad in both additional seeds, fire its strongest image through TRELLIS first. Keep `08` as the clean-shape comparator. Promote `10` only if wave two shows that the volumetric game-render basin is more than a one-in-two event. Do not spend TRELLIS time on `01`, `02`, or `05` from current evidence.
