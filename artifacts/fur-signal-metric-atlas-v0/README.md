# Trellis MLX fur-failure metric atlas

Question: Can topology alone distinguish Trellis MLX's malformed fur geometry from matched ordinary-skin casts strongly enough to recover a useful coat-volume signal?

Result: Yes, narrowly. Relative triangle area, thresholded at the pooled skin-control p99, separates the malformed fur casts from matched skin controls by 0.696 mean face coverage. The exact selection views show coherent full-coat localization across all three fur seeds. They also show that the malformed fragments are the exterior representation itself rather than a separable layer over an intact skin shell. This admits a route-specific MLX failure and coat-volume detector, not clean fur segmentation or a general fur classifier.

Route:

- repo: Kaminos
- worktree: `/private/tmp/kaminos-molten-triradial-proposals-0808`
- branch/head before atlas commit: `cc/molten-triradial-proposals-0808` at `22d88f6b2798bec70ff89dfe92f1bbc2d0fd4c89`
- command: `/Applications/Blender.app/Contents/MacOS/Blender --background --python artifacts/fur-signal-metric-atlas-v0/run_fur_signal_metric_atlas.py -- --campaign artifacts/fur-signal-metric-atlas-v0/campaign.json --output-root artifacts/fur-signal-metric-atlas-v0`
- extractor: Blender 5.1.2 plus NumPy topology analysis
- source generation backend: `trellis2mlx_fast`, six steps, 200,000 target faces, 1024 texture, FLUX seed reused
- prompts: `This shape covered in short dense fur.` and `This shape covered in skin.`
- seeds: 80301, 80302, 80413
- source plate and every GLB are SHA-256 bound in `campaign.json`

Images:

- `views/fur-seed*-relative_area_selected.png`: observed malformed casts with exact skin-p99-selected faces in cyan.
- `views/skin-seed*-relative_area_selected.png`: matched controls showing sparse false selections.
- `views/*-component_sheetness_selected.png`: weaker independent topology channel.
- `sheet.html`: adjacent prompts, route identity, statistics, continuous channels, and exact selections.
- `visual-admission.json`: hash-bound human-visible adjudication of the twelve decisive selection renders.

Supporting route discriminator: `../trellis-official-fine-fur-conformance-v0/README.md` records that the dense MPS-requested official fur cast forms a materially healthier continuous directional surface. That evidence narrows this atlas to the MLX triangular-flake failure regime.

Does not prove: production segmentation, a recoverable intact undercoat, static or dynamic groom quality, general Trellis fur semantics, CUDA parity, or that every MLX fur output will enter this topology regime.
