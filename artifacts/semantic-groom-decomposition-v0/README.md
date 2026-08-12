# Semantic Groom Decomposition V0

## Campaign question

Can a compact semantic inventory turn a single generated character image into
useful hair, fur, and hard-surface regions before an inverse-groom solver is
built?

## Result

Yes, for the downstream proposal-to-mask step on this source. Specific phrases
produce materially more useful masks than broad material nouns:

- `long braided beard` isolates the beard and two braids (`mask-00.png`).
- `shaggy fur cloak` isolates the major coat systems while excluding the beard
  and most hard-surface equipment (`mask-01.png`).
- `fur` produces a noisier and less complete coat proposal (`mask-10.png`).
- `metal armor` independently isolates the helmet (`mask-05.png`).

The run finished in 10.31 seconds. This makes semantic mask proposal cheap
enough for an iterative authoring or solver loop.

## Claim ceiling

This assay does **not** establish unattended VLM inventory generation, hidden
skin reconstruction, 3D mask projection, guide fitting, or production groom
quality. Molten supplied the candidate phrases after inspecting the source, so
the admitted result is narrower: a VLM-quality or human-quality semantic
inventory can drive SAM 3.1 into useful and distinct 2D proposals on a clean,
isolated character source.

## Source and route

- Source: `../trellis-official-fine-fur-conformance-v0/source/official-dwarf-fur-cloak.webp`
- Source SHA-256: `933c10aeebb2920b08cb34a08ab1878817b64eb9e30efdcc3d76731069fc0849`
- Greenroom job: `ccad6d6704ca`
- Route identity: `molten-semantic-groom-sam3.1-dwarf-controls-v0`
- Effective model: `/Users/noahlyons/dev/scripts/quant/models/sam3.1-bf16`
- Effective processor: `sam3_1.Sam31Processor`
- Effective multi-prompt route: `sam3_1.generate.predict_multi`
- Threshold: `0.10`
- Maximum returned proposals: `32`
- Receipt: `sam3-dwarf-controls/receipt.json`

The route identity is preserved by the Greenroom job ledger; the SAM receipt
preserves the effective model and processor but does not duplicate that route
field.

## Visual evidence

- `sam3-dwarf-controls/selected-mask-tinted-sheet.png` compares, clockwise from
  upper left: braided beard, shaggy fur cloak, broad fur, and helmet control.
- `sam3-dwarf-controls/semantic-fur-mask-sheet.png` compares specific and broad
  beard, hair, and fur masks.
- All 32 masks, cutouts, the raw aggregate overlay, and the complete receipt are
  retained so rejected and noisy proposals remain inspectable.

## Next assay

Run an actual compact VLM inventory against the same frozen source, constrain
its output to region/material/style/length/direction/prompt candidates, and
compare its proposed phrases with the admitted human-quality vocabulary. That
isolates the still-open upstream question without rebuilding SAM or beginning
the inverse solver prematurely.
