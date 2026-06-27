# Kaminos

Kaminos is a spatial asset forge and inhabited operational workbench for turning
rough asset evidence into source-honest 3D candidates. It is built around the
idea that generated assets should arrive with provenance, route identity, and
visible limits, not as mysterious final truth.

The current repo contains browser-side prototypes for scene objects, Greenroom
asset intake, splat asset correction, motion witnesses, volume witnesses, and
render handoff contracts. The larger architecture points toward a workbench
where an operator can inspect assets, condition specimens, move through named
world contexts, and keep generated output tied to the evidence that produced it.

## Direction

Kaminos has three public-facing product ideas:

- **Spatial asset forge:** ingest, correct, compose, and hand off assets while
  preserving source and route identity.
- **Inhabited operational workbench:** make long-running work visible as places,
  stations, statuses, and inspectable artifacts instead of a pile of terminal
  logs.
- **Source-honest asset generation:** use model output as candidate material
  beside masks, depth, references, receipts, failures, and explicit authority
  labels.

Read [docs/architecture.md](docs/architecture.md) for the current North Star and
the boundary between implemented substrate and intended interface layers.

## Current Documentation

- [docs/architecture.md](docs/architecture.md): public Kaminos architecture and
  source-honesty posture.
- [docs/splat-assets.md](docs/splat-assets.md): splat asset roots, correction
  sidecars, crop/pivot behavior, and render-handoff boundaries.
