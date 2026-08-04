# FLUX.2 projection carrier sentinel — research notes

## Receipt boundary

- Public result manifest: `result.public.json`, SHA-256 `f3f35020011e246adafbc854c6d840a240c539d12c259038eed58dfe4f9186f5`. It binds the private runtime result SHA-256 `485379e856610b7686af30597e39328be2e16fd259bc15f97fa55883a5e00a3b`; exact host paths and raw receipts are retained in a private source-signed coordination return rather than published from the public repository.
- Visual plate: `experiment-plate.html` with a rendered inspection capture at `experiment-plate.png`.
- Source package: Molten baseline commit `48c63a0f8b89ce28c308940b0b5c529fac335c67`.
- Source projection: orthographic, `front-three-quarter`, yaw `0.42` radians. This is not a strict zero-yaw side plate. The assay therefore tests resistance to *further* projection canonicalization, not strict-side fidelity.
- Fixed generator: `flux2-klein-9b`, cached model revision `92196c8e11f7b6cf2b7493e037d8c5345c559216`, MFLUX `0.17.5`, q4, 512×512, 8 steps, guidance 1.0, seed 80401.
- All four Greenroom jobs terminated `done` with exit code 0 on the requested one-reference or two-reference MFLUX job type. No fallback was observed. Greenroom worker commit: `8ac87f5af0c42f8ff329f7d4b98198cd30d03cd3`, clean.
- The exact prompt is positive-only. It contains no historical horror-list exclusions.

## What happened

| Carrier | Visual result | Projection verdict | Runtime |
| --- | --- | --- | ---: |
| clay | Green-and-purple dotted toy-like quadruped reorganized around a rear-facing rump; four supports survive but their authored spatial relationship does not. | canonicalized | 38.9 s |
| depth | Neutral pale continuous organism; retains the source's left-to-right asymmetry and closest outer-outline reading, although framing and support contours move and the right-side head/facial mass stays semantically unresolved. | partially preserved | 34.1 s |
| normal | Smooth blue rear-facing organism; the right-side head/facial mass is read as a rump-like bulb and the supports become near-symmetric. | canonicalized | 42.5 s |
| depth + normal | Nearly the normal-only rear-view result, slightly more matte and textured; depth does not recover its single-carrier projection behavior. | canonicalized | 65.2 s |

The normal and depth+normal outputs are the visually strongest pair. Whole-frame SSIM is `0.978625`; on a fixed 320×280 organism crop it remains `0.948037`. These are supporting appearance metrics, not a projection oracle, but they agree with inspection. The two-reference result is much closer to normal than to the depth-only output. That does **not** yet distinguish normal-information dominance from second-reference/order dominance because normal occupied slot 2.

Clay also demonstrates a separate failure mode: FLUX consumes source presentation as semantic appearance. The green body, purple supports, and dotted plate texture survive into the generated animal. Likewise, the normal carrier's RGB encoding becomes blue material and lighting. These are not treated as privileged geometry channels by this route; they are ordinary conditioned image tokens.

## Causal uncertainty map

### Absolute projection fidelity

The current observable is jointly caused by authored camera, raster preprocessing, semantic orientation ambiguity, and generator canonicalization.

- **Authored camera truth:** the descriptor records 0.42 rad yaw, so the source already contains front-three-quarter depth cues.
- **Raster preprocessing:** MFLUX 0.17.5 calls `LatentCreator.encode_image()`, which calls `ImageUtil.scale_to_dimensions()`. For this assay it resizes every 256×192 source directly to 512×512 with Lanczos and no aspect preservation. Horizontal scale is 2.0; vertical scale is 2.667. The authored raster silhouette is therefore vertically stretched by 33.3% relative to its horizontal scale before conditioning.
- **Orientation ambiguity:** the benign source has role-labeled primitives in the descriptor, but the raster itself has no unambiguous eye, face, or direction marker. The source's right-side head/facial mass is visually compatible with a rear-body prior.
- **Generator canonicalization:** after the shared preprocessing, clay and normal converge on a rear view while depth does not. Carrier semantics therefore materially alter canonicalization beyond the shared stretch.

### Carrier interpretation

- **Depth:** currently the strongest projection carrier. Its scalar luminance appears to communicate mass order without importing a strong surface/material story.
- **Clay:** carries geometry, palette, and render texture together. FLUX copies all three and can allow the appearance prior to reorganize pose.
- **Normal:** is not consumed as a normal field in any architectural sense visible at this route. Its color field becomes appearance/shading and correlates with strong rear-view canonicalization.
- **Depth + normal:** currently fails to fuse the useful depth behavior with normal detail. The open cause is fusion dominance versus slot/order dominance.

### Multi-reference behavior

The two-reference cell couples two variables: it adds normal information and increases reference cardinality from one to two. The route assigns different conditioning token coordinates to each image (`t_coord=10 + 10*i` in MFLUX), so order is an actual architectural variable. The current result cannot be called “depth loses to normal” until order and duplicate-reference controls are run.

### Stochastic stability

The fixed seed makes this a coherent matched sentinel, but it is one noise realization. The very large qualitative split warrants promotion to a small replication panel; it does not warrant declaring depth universally superior.

## Opportunities and next experiments, ranked

1. **Fix the source-instrument comparison class before spending a broad campaign.** Render generator-native square source plates or apply an explicit recorded letterbox/pad transform so no hidden 4:3→1:1 stretch can impersonate projection failure. Record requested and effective preprocessing identity in the plate descriptor and result manifest. This is Source Plate custody and is the highest-leverage immediate implementation.

2. **Run the two-reference order swap.** Compare `[depth, normal]` against `[normal, depth]` with everything else fixed. If the result follows slot 2, we have order dominance; if it follows normal, we have carrier dominance. This is one cheap, decisive Molten-allocated cell.

3. **Run cardinality controls.** Compare `[depth, depth]` with depth-only and `[normal, normal]` with normal-only. This tests whether the two-reference route itself changes the generation regime before we interpret cross-carrier fusion. The current two-reference cell cost 65.2 seconds versus 34.1 seconds for depth-only and produced no visible projection gain.

4. **Promote a compact native-square replication panel.** On the corrected source, repeat depth and normal at two additional seeds. Promote depth as the default carrier only if its projection advantage survives those replications. Eliminate normal as a primary projection carrier if it repeatedly canonicalizes while depth does not.

5. **Add one deliberately unambiguous asymmetric sentinel.** The present blob is benign but directionally underdetermined. A source with one restrained facial landmark or asymmetric appendage can tell us whether FLUX preserves arbitrary projection when “front” is visually legible. Semantic landmark design touches Phantom's binding custody; Source Plate should expose the carrier slot and collaborate rather than absorbing that work.

6. **Then repeat on the accepted complete cat plate.** The cat is the external-validity sentinel: it tests whether the depth advantage survives a recognizable bauplan and whether the generator preserves a physically meaningful camera rather than merely a blob outline.

7. **Treat palette-neutral carrier design as an open production opportunity.** Depth's success suggests a family of low-semantic-load carriers—depth, silhouette/SDF, or neutral occlusion—not an increasingly elaborate normal-map palette. A small silhouette-versus-depth comparison is more informative than adding stronger textual camera language, because this run already used an explicit exact-camera/exact-silhouette clause and carrier choice still dominated.

## Recommended campaign decision

Do not expand prompting around this result. The prompt already tells FLUX to preserve exact camera, silhouette, proportions, support placement, and mass distribution, and it contains no exclusion list. The next uncertainty is upstream raster authority and multi-reference fusion, not prose strength.

The recommended sequence is: Source Plate emits a generator-native square version of the same descriptor and records preprocessing identity; Molten allocates the order swap plus duplicate-reference controls; depth and normal receive two-seed replication only after that; the winning carrier then advances to the complete-cat sentinel and the Trellis/Stable Fast 3D comparison campaign.

## Evidence limitations

- SSIM values are appearance comparisons with large shared backgrounds; they support but do not adjudicate projection.
- `output.metadata.json` is literally `null` for all four MFLUX outputs despite `--metadata`. The Greenroom receipt, copied under `receipts/`, is the authoritative route/settings record. Generator-native metadata must not be treated as present.
- The current `volatile_output` Greenroom warning reflects execution under a temporary worktree; branch-committed artifacts make the evidence durable, but the private raw receipts retain their historical runtime coordinates rather than portable checkout paths.
