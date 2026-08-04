# Metaball silhouette-authority tranche 01

## Question

Can a friendly low-frequency metaball construction causally steer creature
morphology while FLUX.2 elaborates it under one fixed prompt and generator
configuration?

## Fixed contract

- Model: `flux2-klein-9b`, quantization `4`
- Resolution: `512x512`
- Steps: `8`
- Guidance: `1.0`
- References, in order: clay, depth, normal
- Seeds: `80401`, `80402`, `80403`
- Variants: baseline plus one-axis changes to body length, body depth, dorsal
  arch, posterior mass, support spacing, and support length

The exact prompt and every source/output cell are adjacent in `report.html`.

## Result

All 21 intended cells completed and were visually inspected. All 21 are happy
and nonhostile.

The generator inherited every tested low-frequency morphology axis
directionally across the matched seeds. Support length and body depth produced
the clearest deltas. Body length, dorsal arch, posterior mass, and support
spacing also remained legible, though posterior mass was the weakest of the
six. Seed changed finish, color, facial suggestion, and local surface treatment
far more than it changed the authored morphology delta.

The result does **not** establish exact screen-space silhouette authority. Every
conditioning package presents a strict side view; the generated animals
consistently canonicalized toward frontal or three-quarter views. The model is
therefore re-projecting inherited low-frequency morphology rather than obeying
the authored camera and contour.

Elaboration was also conservative. The outputs are coherent creatures, but
they remain close to smooth source masses. This tranche establishes a causal
morphology channel, not yet the target combination of close silhouette
adherence and rich interior elaboration.

## Operational consequence

The next assay should hold source morphology, prompt, seed, model, steps, and
guidance fixed while varying only the projection carrier: clay, depth, normal,
and depth-plus-normal. Camera wording is not a research direction; if semantic
camera selection is later needed, it belongs upstream in source rendering.

Only after projection authority is measured should the program spend broadly
on prompt wording or topology/material elaboration. Otherwise those sweeps
would confound two distinct questions: whether the model retains the authored
view and how much detail it can add inside that view.

## Runtime incident

The original dorsal-arch seed `80401` job (`d4cf2df84a17`) lost its worker
process and was durably marked `stale_recovery`. Exact structured-command retry
`daf740e917be` completed in `101.143132s` with exit code `0`. The failed receipt,
retry manifest, and replacement receipt remain separate; no failed job was
rewritten into success.
