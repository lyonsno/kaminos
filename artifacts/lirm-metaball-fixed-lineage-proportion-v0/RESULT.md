# Fixed-Lineage Bauplan Proportion Assay V0

## Question

Can one successful rich-animal Flux2 basin inherit substantial low-frequency
bauplan changes when the seed, prompt, model, settings, reference topology,
camera, and projection envelope remain fixed?

## Fixed Contract

- Lineage anchor: maximum-contour-bound-invention, seed `80413`
- Model: `flux2-klein-9b`, quantized `q4`
- Route: `gpu-greenroom/mflux_flux2_edit_promptfile_3ref`
- Resolution: `512x512`
- Steps: `8`
- Guidance: `1.0`
- References: depth target, depth side, repeated depth target
- Projection: fixed world envelope with no per-variant autofit
- Variable: one bauplan proportion at a time

Seven cells cover baseline plus short and long axial length, shallow and deep
body depth, and short and long support length. The visual report places all
three source images, exact prompt, full settings, effective route, generated
output, and visual adjudication in the same row.

## Result

All seven routes completed with exit code `0`, no fallback, and no failed
output. All seven outputs are happy and suitable for operator inspection.

The baseline source images are byte-identical to the prior successful source,
and its decoded RGB output is pixel-identical to the prior seed-`80413` animal.
The route therefore replays deterministically at the visible-pixel level.

| Cell | Visible result | Disposition |
| --- | --- | --- |
| Axial short | Shorter, stockier bear/mustelid with retained face, fur, supports, and camera | In-lineage inheritance |
| Baseline | Exact decoded-pixel replay of the prior lineage anchor | Control confirmed |
| Axial long | Longer trunk and extended horizontal stance in the same animal family | In-lineage inheritance |
| Body shallow | Shallower, lighter body in the same animal family and view | In-lineage inheritance |
| Body deep | Frontal seated tabby cat | Happy semantic boundary crossing; target view lost |
| Supports short | Shorter legs and lower stance in the same animal family | In-lineage inheritance |
| Supports long | Taller-legged striped cat | Direction inherited across a semantic boundary |

## What Changed In Our Model

The rich animal output is neither a fixed seed image pasted over arbitrary
geometry nor a globally smooth morphology function. It has a real local
inheritance neighborhood. Within that neighborhood, the generated anatomy
responds directionally to authored low-frequency structure while retaining a
recognizable animal lineage and rich surface completion.

That neighborhood has nonlinear cliffs. The tested axial interval
`0.78..1.35` remains inside the lineage. Negative body-depth and support-length
excursions also remain inside it. The larger positive excursions cross semantic
boundaries: body depth `0.56` changes species and camera, while support length
`0.57` changes species even though longer legs remain visible.

This means proportion controls should be treated as basin-local coordinates,
not unlimited semantic sliders. The productive research object is now the
radius and shape of those local neighborhoods, including whether a more
anatomically explicit authored carrier enlarges them.

## Program Disposition

This result validates using bauplan variation as a meaningful upstream control
surface for organismal completion. It also gives us a concrete failure mode to
measure: semantic reclassification at large excursions.

The next high-value external-validity test is the operator-authored cat. Its
specific skeletal and muscular organization can tell us whether richer
structural authority expands the continuity neighborhood or whether familiar
animal priors still seize control. A small midpoint sweep can later locate the
positive body-depth and support-length cliffs more precisely, but it should not
delay the cat transfer.

## Claim Ceiling

Experimental evidence for deterministic replay and basin-local directional
inheritance of three low-frequency bauplan axes under one fixed Flux2 lineage.
No general morphology control, globally continuous interpolation, exact contour
preservation, multiview geometric consistency, reconstructed volume, or
production-admission claim.
