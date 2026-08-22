# Style / Construction Atlas Review

## Disposition

The assay stopped at 93 completed FLUX edits after the operator asked for an exact runtime account. All 93 completed images were inspected directly at full resolution. No TRELLIS reconstruction was launched from this atlas.

Seeds `81436`, `81437`, and `81438` completed all 24 prompts. Seed `81439` completed prompts 01 through 21. Prompts `22-bold-cel-painted-maquette`, `23-graphic-low-poly-polystone`, and `24-illustrative-carved-resin` at seed `81439` were intentionally left unrun when the broad worker was stopped; they are not missing outputs presented as evidence.

## Route Evidence

- Requested and effective route: `mflux_flux2_edit_promptfile`
- Source: `../flux-81408/output.png`
- Source SHA-256: `6451fcc15a6fc444e63943039229d958a202ae4ebc001addfc9b20bcb4d511d9`
- Effective model and config: `flux2-klein-9b`, quantization `4`, `512x512`, 8 steps, guidance `1.0`
- Completed cells: 93 image outputs and 93 metadata receipts
- Route/config mismatches: 0
- TRELLIS outputs in this atlas: 0
- Wave-two timing: 36.0-257.9 seconds per cell; 94.3 seconds mean; 4,243.3 seconds total for 45 cells
- Failure phase: operator-bounded stop after prompt 21 of seed `81439`; worker exited cleanly

Per-cell `metadata.json` files preserve job id, input path, exact prompt file, effective parameters, output inventory, and duration.

## Ranked Exact Sources

| Rank | Exact cell | Visual finding | Proposed use |
| --- | --- | --- | --- |
| 1 | `wave-1/seed-81436/16-matte-resin-gallery-sculpture` | Best continuous identity-bearing envelope, complete silhouette, compact terminator, and restrained surface frequency. | Primary continuous-shell TRELLIS source. |
| 2 | `wave-2/seed-81439/20-rounded-attached-lobes` | Cleanest attached-mass construction: symmetric, complete, low frequency, and strongly legible without loose coat detail. | Primary attached-parts TRELLIS source. |
| 3 | `wave-1/seed-81436/17-beveled-connected-planes` | Cleanest joined-plane construction with broad connected facets and little biological noise. | Primary planar-shell TRELLIS source. |
| 4 | `wave-2/seed-81439/13-lacquered-carved-wood` | Strong joined-shell interpretation with readable panel seams, coherent muzzle and cheeks, and no whisker contamination. | Carved-shell alternate. |
| 5 | `wave-2/seed-81439/21-soft-cel-painted-resin` | Clean continuous resin shell with stronger graphic identity than the matte-resin control. | Stylized continuous-shell alternate. |
| 6 | `wave-2/seed-81439/06-feature-animation-sculptural` | Coherent facial core with broad attached plates, clean ears and horns, and a complete terminator. | Identity-rich attached-parts alternate. |

`wave-2/seed-81439/11-stylized-game-sculpted-normals` and `wave-2/seed-81439/17-beveled-connected-planes` are useful reserve sources. The former is a smooth attached-coat interpretation; the latter is an identity-rich planar shell with more biological cheek and ear texture than rank 3.

## Four-Seed Finding

Prompt wording reliably steers macro construction, but it does not independently determine micro-surface cleanliness. Seed `81438` was a broad hostile attractor: it overlaid whiskers and furry cheek or neck detail across ceramic, wood, resin, faceted, and low-poly prompt families while often preserving their intended large-scale construction. Seed `81439` largely escaped that attractor and produced several of the cleanest physical sources.

This revises the wave-one description of "stable prompt families." The defensible claim is stable macro-construction pressure across seeds, not guaranteed clean surface treatment. Exact-cell promotion remains necessary.

## Useful Misses

- Every seed-`81438` cell is preserved as evidence that the same wording can retain macro construction while entering a hostile animal-detail basin.
- `wave-2/seed-81439/19-attached-wedge-clusters` is visually attractive but crosses into drawn illustration and is a poor geometry-conditioning source.
- Several genre-led cells remain coherent images but import fur, costume, foliage, or decorative collars that increase reconstruction ambiguity.
- The three unrun seed-`81439` cells remain explicit unexecuted matrix coordinates, not failed or blank evidence.

## Decision Boundary

The cheapest informative TRELLIS comparison is a matched run over ranks 1 through 3 using the established eight-step, no-cascade default and a declared reconstruction seed. That isolates continuous shell, rounded attached masses, and joined planes before spending on broader style or seed variance. Rank 4 is the next source only if carved panel seams remain decision-relevant after the first three.

This atlas supports source-basin and reconstruction-input selection only. It does not establish mesh quality, backside completion, winding correctness, manifold topology, collision, deformation, or CUDA parity.
