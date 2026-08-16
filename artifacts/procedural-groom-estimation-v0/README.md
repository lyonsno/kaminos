# Procedural Groom Estimation v0

This is the first blind image-side assay over the authored procedural groom
truth fixture. It asks whether a VLM plus prompted segmenter can recover useful
fibrous distinctions without seeing the fixture's membership colors, canonical
system names, guide ids, carrier triangles, barycentrics, or numeric truth.

Open the consolidated review at [`review.html`](review.html). It places all
three sealed observations, the raw VLM inventory, twelve SAM overlays, automatic
all-region comparisons, and the complete fifteen-mask authored truth atlas on
one page.

## First-pass result

Negative. Gemma proposed two broad fiber layers and bilateral whisker-origin
regions, but did not isolate a distinct ruff. Literal SAM3 unions at the sealed
`0.1` threshold were overbroad, background-contaminated, absent in one case, or
semantically misregistered. Several masks achieved near-complete recall only by
engulfing the target; precision commonly fell between 5 and 25 percent. The
comparison selects the maximum-IoU authored region automatically and therefore
does not rename a proposal to fit the answer.

## Separation of evidence

- `observations/` contains three membership-neutral canvas crops plus the
  browser witness that binds camera poses and requested/effective asset route.
- `vlm-inventory-prompt.txt` asks for a free inventory first. It does not name
  the short, puffy, or ruff answer categories.
- The raw VLM output is preserved and compared without an agent-authored
  semantic map. Every proposed mask is scored against every authored region.
- SAM consumes literal prompts proposed from the raw inventory. Whiskers are a
  presence/parameter target; the segmenter targets left and right mystacial
  pads, never individual whisker strands.
- The colored truth manifest remained withheld until the raw proposal was
  sealed to the exact observation digest.

The assay validator rejects membership colors, labels, gizmos, blank images,
stale observation identity, requested/effective route mismatch, truth-bearing
proposal keys, blank masks, missing target regions, and truth release against a
different or unsealed proposal. The pixel comparator fails on blank truth,
dimension mismatch, or mask digest drift and penalizes whole-frame false
positives through IoU and precision.

## Claim ceiling

A successful first pass may support source-specific free-inventory quality,
literal prompt utility, image-space mask utility, coarse direction and
relative-regime estimates, and whisker-presence/mystacial-pad proposal quality
on this authored fixture. It cannot establish arbitrary-source semantics,
anatomical truth, 3D carrier recovery, universal fur reconstruction, curl or
braid recovery, production grooming, deformation quality, or visual admission.

Run the contracts:

```sh
node --test tests/procedural-groom-estimation-contracts.mjs
python3 -m unittest tests/test_procedural_groom_vlm_inventory.py \
  tests/test_procedural_groom_sam3_runner.py \
  tests/test_procedural_groom_comparison.py
```
