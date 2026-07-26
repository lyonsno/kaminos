# Projected support legibility route-around

Question: Can the organismal conditioning maps omit repeated support/contact
geometry while retaining explicit bilateral support semantics for downstream
fitting?

Result: Yes for the local conditioning stage. The repaired cells preserve ten
left/right support sidecars from five declared support pairs while emitting zero
support and contact primitives into the generator-facing body. Agent inspection
of the repaired clay, depth, normal, mask, and semantic maps found a single
continuous low-frequency form with smooth fields and no repeated anatomical,
cavity-like, or partial-occlusion cues.

Route:

- repo: `/private/tmp/kaminos-molten-projected-support-legibility-r2-0725`
- branch: `cc/molten-projected-support-legibility-r2-0725`
- commit: `50cb734b5113c846c91d8f968924c387283656c8`
- command: `TMPDIR=/private/tmp node lirm-projected-support-legibility-assay.mjs`
- model/checkpoint: none; deterministic local procedural SDF
- backend/device: Node.js software SDF raymarch, SVG maps rasterized by `sips`
- source candidate: recorded in `receipt.json`
- matrix: 2 mass levels x 2 support realizations x 2 contact realizations x 2 camera yaws
- map resolution: 192 x 144 source pixel grid displayed at 320 x 240
- timestamp: `2026-07-26T04:02:39Z`

Images:

- `control-sheet.png`: agent-only matrix containing the legacy repeated/contact
  geometry controls and repaired cells.
- `repaired-sheet.png`: operator-safe clay sheet containing only
  `bilateral-sidecar + semantic-only` cells.
- `cells/B0-L1-C1-V0/{clay,depth,normal,mask,semantic}.png`: repaired
  bauplan-only conditioning set at yaw 0.42.
- `cells/B1-L1-C1-V1/{clay,depth,normal,mask,semantic}.png`: repaired
  bauplan-heavy conditioning set at yaw pi/4.

Important hashes:

- `control-sheet.png`: `sha256:9449e244a2c369ea053d312bb6083fc08b6fd7b629da98096ff8555202c384ef`
- `repaired-sheet.png`: `sha256:fc8a0f536f38881718efb6e85da87004139204090e8a3d2090aa4e760591e63f`
- `B0-L1-C1-V0/depth.png`: `sha256:0b292aba4ea6124dda56fa7d90c42250ba4bf1867a471265860b0e6e2ad692b5`
- `B0-L1-C1-V0/normal.png`: `sha256:ed3db181661a5f48d14b318c73612b8d31d7a5c131bfce2571c8aae5cc034529`
- `B1-L1-C1-V1/depth.png`: `sha256:fcc8bcb20fcfe6255b1d5ed9688f92bedfcefb21f55e52849b15d75331b6effa`
- `B1-L1-C1-V1/normal.png`: `sha256:0ec2aed38b844503b9c22d0aa5d80e661dc224e8dfdf60f5ffee665a2920a954`

Does not prove: generator or Trellis aesthetic quality, semantic recovery of
supports from a generated mesh, motion quality, ground contact, or operator
admission of the legacy control sheet.
