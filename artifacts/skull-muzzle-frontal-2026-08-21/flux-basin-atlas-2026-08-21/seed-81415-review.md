# Seed 81415 Direct Review

All eighteen prompt cells completed through the requested Greenroom `mflux_flux2_edit_promptfile` route and were directly inspected against the canonical frontal source. Effective receipts prove `flux2-klein-9b` Q4, 512 square, eight steps, guidance 1.0, seed `81415`, and 48 GB MLX cache. Runs took 36.5-94.6 seconds. No cell failed, fell back, ignored parameters, or emitted a blank or missing image.

## Leading Reconstruction Sources

1. [`09-lifelike-character-maquette`](wave-1/seed-81415/09-lifelike-character-maquette/output.png): best natural hybrid. It retains natural eye scale, muzzle specificity, facial asymmetry, and horn/ear identity while organizing the forehead, cheeks, ear interiors, and ruff into coherent sculpted locks.
2. [`04-cinematic-animation-natural`](wave-1/seed-81415/04-cinematic-animation-natural/output.png): best smooth hybrid. Clean rounded facial volumes and natural eye scale survive, with less explicit coat ownership than `09` but a calmer surface for reconstruction.
3. [`06-modern-game-character`](wave-1/seed-81415/06-modern-game-character/output.png): cleanest colored geometry carrier. Ear inserts, horn volumes, cheek pieces, and mane wedges are explicit, with moderate stylized-eye and phenotype drift.
4. [`08-polished-low-poly`](wave-1/seed-81415/08-polished-low-poly/output.png): strongest plane-ownership extreme. It is an excellent lower-bound reconstructibility source but intentionally sacrifices natural surface detail.
5. [`11-painted-resin-bust`](wave-1/seed-81415/11-painted-resin-bust/output.png): coherent molded-lock extreme with excellent part ownership, glossy material bias, and ornamental relief.

## Additional Basins And Useful Misses

| Prompt | Direct visual disposition |
| --- | --- |
| [`01-hybrid-broad-sculpture`](wave-1/seed-81415/01-hybrid-broad-sculpture/output.png) | Identity-bearing naturalistic bridge with moderately broader cheek and brow organization; fine fur remains. |
| [`02-hybrid-owned-masses`](wave-1/seed-81415/02-hybrid-owned-masses/output.png) | Under-reacts and stays near photographic fur, including a fibrous chin terminator. |
| [`03-hybrid-carved-locks`](wave-1/seed-81415/03-hybrid-carved-locks/output.png) | Over-literal dense carved relief; beautiful object, but high-frequency geometry remains expensive. |
| [`05-feature-animation-natural-eyes`](wave-1/seed-81415/05-feature-animation-natural-eyes/output.png) | Under-reacts toward photography despite preserving natural eye scale. |
| [`07-hand-painted-game-asset`](wave-1/seed-81415/07-hand-painted-game-asset/output.png) | Attractive graphic basin with broad structure but weaker depth evidence than `06`. |
| [`10-stop-motion-maquette`](wave-1/seed-81415/10-stop-motion-maquette/output.png) | Selects literal fuzzy fiber and remains TRELLIS-hostile. |
| [`12-colored-clay-maquette`](wave-1/seed-81415/12-colored-clay-maquette/output.png) | Very clean contiguous object with simplified anatomy and enlarged eyes. |
| [`13-painted-carved-wood`](wave-1/seed-81415/13-painted-carved-wood/output.png) | Strong owned facets and ear relief; material prior turns fur into literal hard blades. |
| [`14-glazed-ceramic`](wave-1/seed-81415/14-glazed-ceramic/output.png) | Smooth coherent shell, but glaze destroys eye readability. |
| [`15-cast-bronze`](wave-1/seed-81415/15-cast-bronze/output.png) | Excellent solid sculpture and relief; deliberately collapses eye/material differentiation. |
| [`16-soft-vinyl-figure`](wave-1/seed-81415/16-soft-vinyl-figure/output.png) | Extremely clean and reconstructible, with strong toy/cute proportion drift. |
| [`17-three-dimensional-cel`](wave-1/seed-81415/17-three-dimensional-cel/output.png) | Clear silhouette but remains visually flatter than the leading geometry carriers. |
| [`18-crafted-felt-puppet`](wave-1/seed-81415/18-crafted-felt-puppet/output.png) | Literal felt and hanging coat panels create a distinct puppet rather than a neutral geometry carrier. |

## First-Seed Decision

Continue all six seeds. Prompt wording is already materially selecting different representation systems rather than merely recoloring one source. Compare `09`, `04`, `06`, `08`, and `11` first across seeds `81416`-`81420`; retain `01` as the naturalistic identity control and `15` as a geometry-only sculptural extreme. TRELLIS promotion waits for cross-seed visual stability and source-specific selection.

Exact Greenroom receipts: `receipts/wave-1/`.
