# Procedural Groom Truth v0

This authored truth fixture establishes a concrete carrier-bound representation
for three fibrous regimes before image-space recovery is attempted:

- a directional short coat split into low- and high-puff halves;
- a longer silhouette-bearing ruff represented by explicit guides; and
- bilateral sparse whiskers instantiated from a mystacial-pad preset.

The whisker contract intentionally asks an upstream vision route to detect
whisker presence and segment the mystacial pad. It does not ask a segmentation
model to recover individual strands. Count, length relative to muzzle width,
fan, elevation, sag, taper, stiffness, sparseness, and confidence are preset
parameters that a later VLM-backed assay may estimate coarsely.

The Blender generator writes one coherent triangulated carrier, canonical guide
roots expressed as carrier triangle plus barycentrics, local frames and flow,
dense derived curves, neutral/deformed root positions, a membership-colored
truth GLB, a distinct membership-neutral observation GLB, and three render
witnesses. The observation GLB cannot alias the colored truth product. The
neutral and deformed geometry use the same analytic
carrier map; the deformation render therefore tests attachment transport rather
than a detached display transform.

The generated manifest may reach
`representation_ready_for_visual_review`. It never self-grants visual or
scientific admission. This fixture does not establish image recovery, arbitrary
source semantics, anatomical truth, production grooming, curl/braid recovery,
or deformation quality.

Run the contract tests:

```sh
node --test \
  tests/procedural-groom-truth-contracts.mjs \
  tests/procedural-groom-review-page-contracts.mjs
```

After Greenroom generation, bind the manifest to the actual generator and
artifact bytes:

```sh
node tools/procedural-groom-truth-preflight.mjs \
  --manifest artifacts/procedural-groom-truth-v0/generated/manifest.json \
  --repo-root "$PWD" \
  --report artifacts/procedural-groom-truth-v0/generated/preflight.json
```

The current run, direct visual comparison, interactive-geometry witness, and
claim ceiling are collected in [`evidence-sheet.md`](evidence-sheet.md).

For operator review, serve Kaminos and open
[`review.html`](review.html). It places the membership legend, sparse guide
truth, dense neutral-pose groom, deformation witness, and interactive
membership-colored truth GLB on one page; no local filesystem-link traversal
is required. The separate `procedural-groom-observation.glb` is reserved for
blind VLM/SAM input and does not appear on the answer-key page.

Generation is a protected Blender route in this shop and must run through GPU
Greenroom. The request records the requested route; the generated manifest
records both requested and effective route identity.
