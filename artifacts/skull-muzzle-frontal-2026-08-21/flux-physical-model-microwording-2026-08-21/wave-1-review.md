# Physical-model micro-wording: wave-one review

Status: 32/32 wave-one images directly inspected (seeds `81427` and `81428`; prompts `01`-`16`). No contact sheet was used as visual evidence.

## Fixed route

- Source: `../flux-81408/output.png`
- Source SHA-256: `6451fcc15a6fc444e63943039229d958a202ae4ebc001addfc9b20bcb4d511d9`
- Requested and effective route: `mflux_flux2_edit_promptfile`
- Model: `flux2-klein-9b`, Q4
- Config: 512 x 512, 8 steps, guidance 1.0, MLX cache limit 48 GB
- Comparison: exact source and route settings held fixed while prompt wording and seed varied

## Reconstruction nominations

1. `wave-1/seed-81427/05-silicone-inset-eyes/output.png`
   SHA-256: `597d937f3983bda4bbbc23cd59ab8005617211ce38881929e0d885975131bf9d`

   Best repeatable physical-model basin. Both seeds produced coherent, whisker-free busts with complete terminators, explicit joined facial masses, inset eyes, and low surface frequency. Seed `81427` carries the stronger identity and eye arrangement.

2. `wave-1/seed-81427/15-low-poly-connected-facets/output.png`
   SHA-256: `4848ebfe354b2287357446db9ecc22d31777a4ebcf209db7f3e619fd67615896`

   Best explicit geometry carrier. Connected facets make part ownership unusually legible, the silhouette and terminator are complete, and no thin whiskers compete with reconstruction. It spends some natural identity for structural overdetermination.

Promote both to matched native-MLX Trellis probes at the established control: 8 steps, cascade disabled, 100000 target faces, 512 texture resolution, simplify-first. The pair tests whether Trellis benefits more from smooth joined masses or from explicitly faceted source geometry.

## Identity-rich alternates

- `wave-1/seed-81427/02-polystone-joined-masses/output.png`
  SHA-256: `c734df461be3f3dca52c7c261f6860f1aaded7ebf633b9dc06aa7d9b6e4d29c7`

  Strongest natural identity/material compromise. It preserves expressive amber eyes and believable facial anatomy, but carries finer ruff detail than nomination 1.

- `wave-1/seed-81427/04-painted-production-maquette/output.png`
  SHA-256: `ec97e8de7493bea31dcc00fcbf486180c97081c0cff8b5aad8e5e2b2ee165381`

  Strong naturalistic face with a clean physical bust and moderate layered fur. The same prompt produced long whiskers at seed `81428`, so it is a strong exact source but not a stable prompt family yet.

## What the wording changed

- `05-silicone-inset-eyes` was the strongest cross-seed physical-model wording. It reliably suppressed hair noise without erasing all authored form.
- `01`, `02`, and `04` can produce excellent maquettes, but identity, eye consistency, and whisker generation still vary materially by seed.
- `07` and `08` consistently moved into clean 2D animation art. They are valid style-basin evidence but weaker reconstruction sources because their physical form is less explicit and they retain thin whiskers.
- `15-low-poly-connected-facets` consistently produced connected low-poly busts. Both seeds were structurally clean; `81427` retained the better identity.
- `16-stylized-game-subtle-surface` returned to fine fur and whiskers in both seeds, making it a poor Trellis-conditioning intervention despite attractive images.

## Useful misses

- `81428/10-console-adventure-solid-pieces` discovered a coherent scale-plated dragon/creature basin. It is not this skull-muzzle identity, but it is valuable style vocabulary and must remain preserved.
- `81428/03-resin-layered-pieces` produced a helmeted/mechanical face, showing that `layered pieces` can redirect semantics rather than merely simplify surface frequency.
- `81427/11-hand-painted-physical-model` produced severe protruding-eye anatomy. This is a prompt/seed miss, not a reconstruction candidate.
- `06`, `12`, `13`, and `14` frequently over-smoothed identity into generic mascot, vinyl, or ceramic forms.

## Claim ceiling and next decision

Wave one establishes that physical-model micro-wording can move the same source into materially different and sometimes repeatable reconstruction-friendly image basins. It does not establish better geometry. The next decision is visual: reconstruct the two nominations with the matched 8-step/no-cascade control and compare their full orbit, eye placement, rear completion, holes, winding behavior, and retained identity against the existing best casts.
