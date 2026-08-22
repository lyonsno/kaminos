# Style / Construction Atlas Wave-One Review

## Disposition

Seeds `81436` and `81437` completed all 48 requested cells. Every image was inspected directly at full resolution. No contact sheet was used as promotion evidence.

The useful control is construction language, not genre language. Direct material and part-hierarchy prompts repeatedly produced continuous low-frequency shells, connected planes, or attached secondary masses. Game, storybook, collectible, and painterly labels produced attractive images but were more likely to import costume, leaves, realistic fur, whiskers, or flat illustration.

## Route Evidence

- Source: `../flux-81408/output.png`
- Source SHA-256: `6451fcc15a6fc444e63943039229d958a202ae4ebc001addfc9b20bcb4d511d9`
- Effective route: `mflux_flux2_edit_promptfile`
- Effective model: `flux2-klein-9b`, quantization `4`
- Effective image settings: `512x512`, 8 steps, guidance `1.0`
- Seeds: 24 cells at `81436`; 24 cells at `81437`
- Timing: 35.1-94.5 seconds per cell; 58.8 seconds mean
- Route/config mismatches: 0
- Missing or blank outputs: 0

Per-cell `metadata.json` files preserve job id, input path, exact prompt file, effective parameters, output inventory, and duration.

## Ranked Exact Cells

| Rank | Exact cell | Visual finding | Next route |
| --- | --- | --- | --- |
| 1 | `seed-81436/16-matte-resin-gallery-sculpture` | Best identity-to-simplicity balance: continuous physical envelope, shallow markings, complete ears and horns, compact terminator, and almost no loose coat geometry. | Primary identity-bearing TRELLIS probe. |
| 2 | `seed-81436/17-beveled-connected-planes` | Best explicit connected-geometry plate: broad joined facets describe the entire face without floating shards or craft-toy lobes. | Primary planar-construction TRELLIS probe. |
| 3 | `seed-81437/13-lacquered-carved-wood` | Strong assembled-shell alternate with stable carved panel seams, explicit radial termination, and no strand fur. | Probe if the first pair shows materially different reconstruction behavior. |
| 4 | `seed-81436/06-feature-animation-sculptural` | Strong attached-secondary-parts hierarchy over a continuous face core; the same construction class repeated at seed `81437`. | Attached-parts alternate. |
| 5 | `seed-81436/09-console-adventure-painted-sculpt` | Most successful Nintendo-adjacent physical sculpt: graphic, clean, and low frequency while retaining a severe face. The second seed flattened toward illustration, so this is an exact-cell promotion rather than a stable prompt-family claim. | Aesthetic-ceiling TRELLIS probe after construction controls. |
| 6 | `seed-81437/23-graphic-low-poly-polystone` | Stable low-poly extreme with complete major anatomy and a simple terminator; the family repeated across both seeds but spends more identity. | Topology-extreme diagnostic. |

## Stable Prompt Families

| Prompt | Two-seed behavior |
| --- | --- |
| `07-stylized-realism-maquette` | Repeated a smooth complete physical head with shallow markings and low surface frequency. Stable but softer in identity than exact cell `81436/16`. |
| `16-matte-resin-gallery-sculpture` | Repeated the continuous low-frequency envelope. Seed variance affected facial life more than construction. |
| `17-beveled-connected-planes` | Repeated coherent connected facets with the strongest construction stability in the atlas. |
| `06-feature-animation-sculptural` | Repeated broad attached planes over a core, with meaningful layout variance but stable part hierarchy. |
| `13-lacquered-carved-wood` | Repeated carved panel segmentation and physical material ownership; material may bias later texture/surface segmentation. |
| `23-graphic-low-poly-polystone` | Repeated a complete low-poly physical head; identity drift is explicit. |

## Useful Misses

- `03-resin-effects-maquette` and `12-console-rpg-physical-bust` repeatedly reintroduced realistic fur, whiskers, or costume.
- `15-hand-painted-polystone-collectible` repeatedly imported clothing or a pedestal despite producing coherent faces.
- `08-painterly-animation-model` and `22-bold-cel-painted-maquette` crossed into flat illustration and are not honest reconstruction sources.
- `10-storybook-game-maquette` repeatedly imported leaves and lost important phenotype details in seed `81437`.
- `19-attached-wedge-clusters` produced useful attached modules but changed their scale and organization sharply between seeds.
- `20-rounded-attached-lobes` did not preserve its attached-lobe construction across seeds.
- `24-illustrative-carved-resin` changed from a collared carved bust to a smooth head and is not a stable construction basin.

## Decision Boundary

Keep the full second seed pair (`81438`, `81439`) running. Directly inspect it before making a four-seed family claim. If exact cells `16` and `17` remain visually strong in the wider envelope, fire the best identity-bearing continuous source and the best connected-plane source through matched eight-step, no-cascade TRELLIS. Treat cells `09` and `23` as stylization and topology diagnostics, not replacements for the primary pair.

This review supports image-basin and reconstruction-source selection only. It does not establish mesh quality, backside completion, winding correctness, manifold topology, collision, deformation, or CUDA parity.
