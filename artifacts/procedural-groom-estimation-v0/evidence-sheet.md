# Procedural Groom Estimation v0 — Evidence Sheet

## Campaign question

Can a blind image-side route distinguish a short coat, a puffy coat, a distinct
ruff, and whisker-origin pads well enough to propose useful fibrous regions and
coarse groom parameters before any authored truth is exposed?

## Source conditioning

The input is the deterministic procedural carrier/groom fixture
`procedural-groom-truth-v0`. The VLM received exactly three neutral browser
captures listed in [`observation.json`](observation.json): front, left
three-quarter, and right three-quarter. Membership colors, labels, transform
gizmos, canonical guide ids, barycentrics, region names, and numeric truth were
withheld. The source witness SHA-256 is
`87febf53f13d679d229aba2c865bdf3655a7174492e958a7f0b2947e21c780d8`.

## Exact prompt and routes

- Prompt: [`vlm-inventory-prompt.txt`](vlm-inventory-prompt.txt), SHA-256
  `725c5f121d35763fde4640d295c89fcdefc7b739512ef675c5ecf56c0da9264b`.
- VLM: `mlx-community/gemma-3-4b-it-qat-4bit` through the effective local
  `mlx-vlm` Metal route. Raw bytes and the terminal parse repair are under
  [`vlm-raw/`](vlm-raw/).
- Segmenter: `mlx-community/sam3-bf16`, effective route
  `mlx-vlm:sam3:mlx-community/sam3-bf16`, config SHA-256
  `6cee26705ae0aadce09406d375053603279d9b0d25c3de0c0cfe943a371bdd18`,
  sealed score threshold `0.1`. The terminal report and every union/overlay are
  under [`sam3-raw/`](sam3-raw/).
- Comparison: maximum per-view IoU against every authored region with no
  agent-authored semantic hand-map. See [`comparison.json`](comparison.json),
  SHA-256 `b2d34eb49459c58152db71d35b0ebe801b0c1a06f2be4d2d1f49b1843ab8287c`.

## Result

The VLM proposed a broad primary fiber layer, a supporting inner fiber layer,
and bilateral whisker-origin pads. It did not propose a distinct ruff. Its
coarse relative length/density/puff ordering contains some useful proposal
signal, but the dominant-flow vectors are not credible normalized directions
and the same generic boxes were repeated across views.

The literal SAM pass did not produce useful region masks. Most unions engulfed
large portions of the head, studio floor, or background. Their apparent recall
was therefore often 94–99 percent while precision remained roughly 5–25
percent. The left-view right whisker pad produced no detection. The strongest
numeric overlap, IoU `0.518`, came from the right-whisker-pad proposal matching
the authored **ruff**, which is semantic anti-evidence rather than a pad success.
The intended whisker-pad IoUs were at most `0.097` across the captured views.

## KEEP / HYBRID / REPLACE disposition

- **KEEP:** the blind three-view capture contract, raw proposal sealing, VLM
  inventory as proposal fuel, explicit whisker-presence → mystacial-pad target,
  all-region comparison, and complete truth atlas.
- **HYBRID:** retain VLM semantic proposals and coarse parameter estimates, but
  bind each proposal to view-specific spatial evidence and normalize/validate
  flow before a segmenter consumes it.
- **REPLACE:** the current literal phrase + generic repeated box + low-threshold
  union policy. It is the direct cause of background engulfment and semantic
  misregistration on this fixture.

## Visual witness

The consolidated review is [`review.html`](review.html). It was captured in a
1600 × 16000 browser frame and inspected end-to-end:

- [`review-page-smoke.json`](review-page-smoke.json)
- [`review-page-full-smoke.png`](review-page-full-smoke.png)
- [`visual-inspection.json`](visual-inspection.json)

No blank or broken images were observed. All three inputs, twelve comparison
rows, and fifteen authored truth masks are visible on the page.

## Claim ceiling

This pass establishes source-specific negative evidence for this free-inventory
Gemma prompt plus literal SAM3 `0.1`-threshold union route. It does not establish
that VLM-guided proposal is generally useless, that a different box/point
strategy or calibrated threshold cannot segment the fixture, that arbitrary
source semantics are understood, or that any 3D carrier, production groom,
curl, braid, deformation, or source-identity result has been recovered.

Visual admission: false. Scientific admission beyond the bounded negative
result: false.
