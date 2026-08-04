# Bowplan Reference Cardinality V0 Result

## Question

Did the prior multiview gain come from complementary structural information, reference count, or reference order?

## Fixed Conditions

- Square 256 x 256 orthographic depth carriers from the same procedural Bowplan
- `flux2-klein-9b`, 4-bit, seed `80401`, 8 steps, guidance `1.0`, 512 x 512 output
- One new one-reference cell, three new two-reference cells, and the authenticated prior `[T,T,T]` control
- Exact prompt, references, route, settings, and output are visually adjacent in `report.html`
- Effective-route evidence is preserved in `receipts/`; the three-reference control retains its original receipt

## Inspected Result

All outputs are benign and suitable for ordinary operator inspection. None contains the previously identified hostile aperture or clustered-organ pattern.

The target-only family converged on nearly the same featureless rear-facing plush body at every cardinality. `[T,T]` versus `[T,T,T]` measured `0.986846` whole-frame SSIM. `[T]` added a small cranial-like bulge but remained close to `[T,T]` at `0.966067`. Duplicate target references therefore did not recover target-camera authority.

The mixed-view family changed the low-frequency body dramatically. Both `[T,S]` and `[S,T]` produced the same broader side-resolved morphology despite reversing reference order; their whole-frame SSIM was `0.962232`. `[T,S]` versus target-only `[T,T,T]` was `0.868580`.

The two-reference mixed-view outputs retained the smooth depth-carrier appearance and did little semantic surface elaboration. The corresponding three-reference mixed-view output added fur and more organic surface interpretation while preserving substantially the same broad morphology (`0.879282` SSIM against `[T,S]`).

## Decision

Complementary reference content, rather than duplicate-reference cardinality or first/last slot dominance, is the load-bearing cause of the structural change. The generator can combine two Bowplan projections into a stable low-frequency interpretation, and that interpretation is largely invariant to swapping their order under the tested prompt.

Reference count appears to affect elaboration style more than low-frequency form: the two-reference route is literal and carrier-like, while the three-reference route is more willing to hallucinate organismal surface. That route-level difference needs a matched prompt/cardinality follow-up before it can be treated as a general property.

## Claim Ceiling

This result supports:

- complementary depth views materially disambiguate low-frequency morphology;
- duplicate target views do not materially improve target projection retention;
- two-reference order is weak for the tested target/side pair;
- low-frequency structure can remain similar across two-reference and three-reference routes while elaboration changes.

It does not establish exact target-camera control, prompt-index obedience, coherent 3D reconstruction, cross-view identity outside this Bowplan, or a correspondence field back to authored components.
