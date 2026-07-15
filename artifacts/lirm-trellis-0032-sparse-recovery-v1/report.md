# Source 0032 Prior-Heavy Sparse-Guidance Recovery

This extension asks whether the radial crawler source `0032` recovers connectedness and source identity as Trellis sparse-structure guidance rises from `0.25` through `1.00`. It holds seed, sparse sampler interval/rescale, downstream Shape sampler, decode, mesh, texture, and witness cameras fixed. The effective route for every generation is GPU Greenroom job type `trellis2mlx_molten_sparse_pressure_ee75fdb` in Trellis worktree `ee75fdb`; every camera witness uses the same four-view Blender route as the multisource assay.

## Visual Disposition

| Sparse CFG | Visible result | Connectedness | Source identity |
| ---: | --- | --- | --- |
| `0.25` | Tall, elegant, one-eyed hook-limbed organism with a detached organ above it. | Main body coherent; one displaced component. | Low. It preserves an eye-like focal feature while abandoning the compact bulbous crawler and radial contacts. |
| `0.50` | Several separated creature chunks: eye-bearing head, body mass, clawed appendage, and smaller organ. | Failed. Large disconnected components dominate every view. | Low. Individual source-like motifs survive without a unified organism. |
| `0.75` | Low clawed body with displaced head/organ masses and broad thin shell-like sheets. | Failed. Several major components remain detached. | Partial at the motif level. Low locomotor contacts return, while gestalt remains broken. |
| `1.00` | Broad top-heavy organism with a mouth-like anterior opening, low clawed contact lobes, a large sheeted torso, and a few detached spikes. | Materially improved. Most mass reads as one organism, with a major internal opening and minor detached detail. | Partial. Bulbous massing and low radial locomotion return; the giant eye, compact cephalopod silhouette, and coherent limb ring do not. |

The tested prior-heavy interval contains no full source-identity recovery point. Sparse CFG `1.00` is the strongest result for connectedness and source-relative gestalt, while still landing far from the source image. Sparse guidance strength is therefore a gross-topology control with a source-dependent, non-monotonic response. For `0032`, increasing `0.25 → 0.50 → 0.75 → 1.00` does not produce a smooth interpolation from prior invention to source adherence.

## Geometry And Time

| Sparse CFG | Sparse voxels | Raw triangles | Final triangles | Too-large holes | Greenroom runtime |
| ---: | ---: | ---: | ---: | ---: | ---: |
| `0.25` | 356 | 234,736 | 198,361 | 99 | 139.1 s |
| `0.50` | 435 | 236,208 | 200,016 | 41 | 87.5 s |
| `0.75` | 458 | 236,416 | 197,320 | 78 | 307.0 s |
| `1.00` | 590 | 296,336 | 197,799 | 70 | 51.8 s |

The box was under variable contention, especially during `0.75`; these timings are receipts, not a performance comparison. Sparse voxel count rises across the extension, while connectedness and identity do not track that count monotonically. Numerical morphology remains supporting evidence only.

## Decision

The next bracket should move into conditional amplification above `1.00`. Run sparse CFG `2.00` and `4.00` first, preserving this exact route and witness contract. Those points can bracket the lowest strength that restores the source's giant-eye radial-crawler identity; a subsequent midpoint is indicated only after visual inspection. Default-like `7.50` remains the upper reference rather than the next first probe.

The useful creature-control lesson survives the failure: low guidance reliably invites the model prior to redesign crude morphology, while source identity requires a separately located adherence threshold. A creature crucible should expose and search that tradeoff as a source-dependent firing parameter rather than treating one fixed CFG as universal.
