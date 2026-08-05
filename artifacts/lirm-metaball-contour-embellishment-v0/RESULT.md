# Bowplan Contour-Bound Embellishment V0

## Question

How much organismal elaboration can Flux2 induce from one fixed all-depth
`[target, side, target]` low-frequency Bowplan carrier before familiar-animal
completion begins to overwrite authored morphology?

## Fixed Contract

- Model: `flux2-klein-9b`, quantized `q4`
- Route: `gpu-greenroom/mflux_flux2_edit_promptfile_3ref`
- Resolution: `512x512`
- Steps: `8`
- Guidance: `1.0`
- Seeds: `80411`, `80412`, `80413`
- References: identical depth target, depth side, repeated depth target
- Variable: prompt class only

The report places every source image, exact prompt, seed, settings, effective
route, and generated output in the same row. The prior all-depth furred result
at seed `80401` appears first as an explicit baseline.

## Visual Result

All nine new outputs completed through the requested route and were visually
inspected. All are happy and suitable for operator inspection.

| Prompt class | Seed 80411 | Seed 80412 | Seed 80413 |
| --- | --- | --- | --- |
| Restrained completion | Near-literal smooth implicit completion | Furred compact bear-like animal | Soft spotted opossum/capybara-like animal |
| Organismal elaboration | Stylized furred bear/mustelid | More realistic bear | Furred bear/mustelid |
| Maximum contour-bound invention | Rich stylized otter/bear with enlarged tail and face | Detailed bear with support reinterpretation beneath front paws | Detailed bear/mustelid with ground plane |

## Findings

1. **Prompt language controls organismal commitment.** At matched seed `80411`,
   the restrained prompt remains nearly source-literal while the organismal
   prompt produces a complete furred animal with face, paws, markings, and
   coherent regional anatomy.
2. **Seed remains a major basin selector.** The restrained row ranges from
   smooth abstraction to two distinct completed animals despite identical
   sources and settings.
3. **Stronger elaboration collapses ambiguity toward a familiar animal.** All
   three organismal cells and all three maximum-invention cells converge on a
   compact bear/mustelid family rather than preserving open-ended species
   identity.
4. **Low-frequency organization survives substantial completion.** Major body
   masses and the radial support organization remain recognizably inherited in
   every cell, even when fur, faces, paws, and tails appear.
5. **Maximum invention exceeds the safe structural budget.** It adds more
   facial and surface specificity but does not add useful morphological
   novelty. It increases silhouette drift and, in one cell, reinterprets source
   support geometry as hardware beneath the paws.

## Program Disposition

The all-depth carrier has enough representational freedom to support a real
organismal-completion stage. Text is a consequential control surface, but it is
not a clean scalar embellishment dial. It changes the probability of committing
to familiar anatomical basins, while seeds choose among those basins.

Promote **restrained** and **organismal** prompt classes into the first complete
operator-authored cat transfer. Do not promote maximum-invention language. The
cat's explicit anatomical structure is now the right external-validity test:
it will show whether a more specific Bowplan can retain authored morphology
while receiving organismal finish, or whether Flux still normalizes it toward a
familiar animal prior.

Source Plate's asymmetric sentinel remains the immediate carrier-authority
test. This result does not replace its directional landmark and contour gates.

## Claim Ceiling

Experimental evidence for prompt-conditioned elaboration under one fixed
all-depth target/side/target Bowplan carrier. No exact contour preservation,
directional anatomy, multiview geometric consistency, reconstructed-volume, or
production-admission claim.
