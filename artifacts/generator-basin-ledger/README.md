# Generator Basin Ledger

This ledger tracks local image generator basins that are aesthetically useful, source-preserving, or spatial-conversion-friendly.

The purpose is pattern extraction: learn which source/control images, prompt language, and route settings reliably put local generators into rich objectful regions, then learn which of those regions survive Trellis/Sharp/SF3D conversion.

## Classification

- `identity_hit`: output stays recognizably tied to the source scaffold or object while adding the requested material, style, or phenomenon.
- `good_miss`: output drifts from the source identity but lands in an attractive, objectful, directionally useful basin.
- `dead_miss`: output collapses into flat icon, mush, generic texture/fire/glow, prompt refusal, or non-object.
- `meshable_raw_hit`: spatial route preserves enough object identity or silhouette to justify further mesh/splat spend.
- `mesh_final_hit`: final viewable mesh/splat asset preserves enough identity/material to enter asset-pipeline evaluation.

## Fields

`basin-ledger.jsonl` stores one JSON object per route outcome. Key fields:

- `id`: stable row id.
- `source_ref`: source image/control/mesh witness.
- `route`: generator or spatial conversion route.
- `intent`: transform, insert, style, creature-good-miss, spatialize, or other.
- `classification`: one of the classifications above.
- `basin_tags`: compact tags for prompt/visual basin learning.
- `visual_read`: inspected visual verdict, not a proxy score.
- `next_pressure`: what the result suggests trying next.

Rows are evidence notes, not immutable truth. If later outputs revise the read, add a new row with a supersession pointer instead of rewriting history.
