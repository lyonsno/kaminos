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
