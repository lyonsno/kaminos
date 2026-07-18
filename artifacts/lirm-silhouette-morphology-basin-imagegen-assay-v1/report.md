# LIRM Morphology Basin Imagegen Assay

## First Tranche

The first tranche compares four visually distinct connected implicit-body controls under two prompt stances and two conditioning stacks at fixed seed `717031`. All 16 cells passed route, request, source, prompt, settings, output, freshness, nonuniformity, and uniqueness verification in `route-receipts.json`.

Visual evidence:

- `morphology-basin-control-strip.png` shows the four clay controls.
- `morphology-basin-output-contact-sheet.png` shows each control's lineage-seed and prior-forward outputs under clay+normal and clay+depth+normal conditioning.

Inspected verdict:

- `lineage-seed` reliably produces complete volumetric organisms, but strongly prefers a conventional four-limbed dragon/amphibian body plan. The controls still steer center of mass, pose, and gross silhouette: basin 10 yields a lower crouch, basin 15 an elongated body, and basins 03 and 22 preserve their distinct front-heavy envelopes.
- `prior-forward` usually preserves the scaffold too literally as a clay maquette. Basin 15 is the important exception: both conditioning stacks resolve a complete segmented crawler with a substantially different locomotion and silhouette regime.
- Clay+depth+normal does not materially improve this matrix over clay+normal. It changes local anatomy and adherence, but the prompt stance dominates the visible basin. The adaptive tranche therefore spends compute on prompt and seed diversity using clay+normal rather than repeating the depth channel.
- The experiment clears the first load-bearing gate: crude implicit controls can steer coherent creature generation, and at least one control/stance pair reaches a non-tetrapod body-plan basin. It does not yet establish reliable broad gestalt diversity or a LIRM-specific attractor.

## Adaptive Tranche

`tranche2/plan.json` expands the remaining authorized image budget into 24 cells: four controls, three prompt stances, two fresh seeds, and clay+normal conditioning. `lineage-seed` measures seed stability of the first quadruped attractor. `non-tetrapod-crawler` and `silhouette-metabolizer` test two routes for preserving control identity while shifting locomotion and body-plan priors away from conventional vertebrate quadrupeds.

All 24 cells passed request, receipt, route, reference ordering, prompt, settings, freshness, nonblankness, dimensions, and cross-cell uniqueness verification in `tranche2/route-receipts.json`. The exact generated PNGs are copied into `tranche2/outputs/` and hash-bound by `tranche2/durable-output-manifest.json`. `tranche2/morphology-basin-output-contact-sheet.png` is the inspected 4-column by 6-row witness; SHA-256: `d5423b6ecbb98d0cb887c3df0165bcc820dc57e524dc9bf77037324dea6f0ed7`.

Runtime remained prompt-insensitive at this scale. The 24 Flux2 Klein 9B jobs averaged 57.5 seconds. `lineage-seed`, `non-tetrapod-crawler`, and `silhouette-metabolizer` averaged 57.7, 55.9, and 58.9 seconds respectively; the two seeds averaged 57.0 and 58.0 seconds.

### Prompt and seed control law

- `lineage-seed` remains a stable conventional-creature attractor. It turns every scaffold into a coherent armored reptile, amphibian, or fantasy quadruped. The controls still affect crouch, length, mass distribution, and stance, but topology diversity is low.
- `non-tetrapod-crawler` reliably lowers the body, increases segmentation, and shifts contacts outward. Its strongest cells, basin 10 and basin 15 at seed `717032`, become compact multi-contact larval crawlers rather than upright fantasy quadrupeds. The route is directionally reliable, though large eyes and terminal mouths remain strong model-prior attractors.
- `silhouette-metabolizer` supplies the largest topology departure. It interprets control lobes and openings as load-bearing cavities, arches, doubled masses, and asymmetric body structure. Basin 03, basin 10, and basin 22 at seed `717032` are complete isolated objects whose gestalt is materially outside the lineage-seed family.
- Seed pressure is highly structured rather than cosmetic. Across all four scaffolds, seed `717032` permits larger topology invention. Seed `717033` more often returns to a familiar lizard or quadruped even under the crawler and metabolizer prompts. The seed is therefore a basin selector in this flow, not merely a local-detail randomizer.

The metabolizer's hollow forms are not yet evidence of anatomically valid creatures. Some cavities read as eye sockets or skull openings, and some contact plans remain vertebrate-like. They are still valuable because they demonstrate a stronger proposition: a crude implicit scaffold can be transformed into a coherent object with substantially different silhouette and internal negative space while retaining scaffold-specific mass distribution.

### Trellis promotion set

Five `717032` cells cover nonredundant crystallization questions and consume the authorized five-run Trellis budget:

| Cell | Visible question |
| --- | --- |
| basin 03 / metabolizer | Does the upright bifurcated hollow body survive as a complete rear-resolved cast? |
| basin 10 / crawler | Does the clean segmented low crawler preserve its multi-contact locomotion plan? |
| basin 10 / metabolizer | Does the asymmetric front-loaded cavity structure remain one coherent object in 3D? |
| basin 15 / crawler | Does the compact larval crawler remain distinct from basin 10 after crystallization? |
| basin 22 / metabolizer | Does the largest arch-bodied negative-space structure resolve rather than collapse into a shell? |

`tranche2/trellis-plan.json` binds those exact input hashes to a fixed comparable route: `gpu-greenroom/trellis2mlx_fast`, seed `42`, resolution `512`, six steps, no cascade, 200,000 target faces, 1024px textures, and simplify-first. `tranche2/trellis-submission-report.json` records the five submitted Greenroom job IDs. No 3D result is admitted until the effective completion receipt proves that route and a four-view Blender witness establishes visible topology survival.
