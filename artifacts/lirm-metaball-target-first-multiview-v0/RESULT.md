# Target-First Multiview V0 Result

## Question

Can supplemental depth views help Flux elaborate an authored low-frequency Bowplan while preserving one named target projection, and does reference slot position materially change that behavior?

## Fixed Conditions

- Model: `flux2-klein-9b`, quantized to 4-bit
- Seed: `80401`
- Sampling: 8 steps, guidance `1.0`, 512 x 512 output
- Carrier: square 256 x 256 orthographic depth renders
- Prompt family: the target reference index changes by condition; all other wording remains structurally matched
- Outputs: `generated/<condition>/seed-80401/output.png`
- Effective-route evidence: `receipts/<condition>.json`

## Inspected Result

All five outputs are aesthetically benign and suitable for ordinary operator inspection.

The repeated-target baseline `[T,T,T]` did not retain the requested target projection. It canonicalized into a substantially rear-facing organism. Adding one genuine side view produced a large and repeatable directional change: `[T,T,S]`, `[T,S,T]`, and `[S,T,T]` all restored a legible right-side cranial mass and a broader side/three-quarter body reading.

Reference slot position had only a small effect inside that matched set. Whole-frame SSIM was `0.981018` for side-last versus side-middle, `0.970911` for side-last versus side-first, and `0.972530` for side-middle versus side-first. In contrast, repeated-target versus side-last was `0.852781`.

The genuinely distinct `[F,T,R]` condition produced another large change (`0.875105` SSIM versus side-last). It retained an asymmetric right-side bulge but read as a front/rear compromise and visibly copied carrier markers. It is evidence that reference diversity contributes structure, not evidence of a coherent reconstructed volume.

## Decision

The strongest current explanation is **complementary-view disambiguation**, not last-slot dominance and not reliable text-addressed target-camera authority. A distinct side reference materially changes the inferred low-frequency body, while moving that same side reference among three slots barely changes the output.

This makes multiview conditioning a high-leverage direction, but the exact cause remains confounded by reference cardinality. The next assay must compare one, two, and three square depth references at the same seed and generator settings, including both `[T,S]` and `[S,T]`.

## Claim Ceiling

This result supports only these claims:

- reference diversity materially changes inferred low-frequency form;
- a complementary side view can recover directional structure lost by three duplicated target references;
- reference order is weak within the tested three-reference side-view conditions.

It does not establish exact target-projection preservation, semantic reference-index obedience, multiview geometric consistency, or a reconstructable 3D correspondence field.
