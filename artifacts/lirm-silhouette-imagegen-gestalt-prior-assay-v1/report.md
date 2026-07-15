# Latent Silhouette Gestalt / Model-Prior Assay v1

## Question

Can four structurally divergent samples from the learned identity-free silhouette prior steer Flux2 into materially different creature basins, and how should prompt pressure trade literal scaffold adherence against useful model-prior invention?

## Source Contract

- Source route: `kaminos/lirm-speciation-armature/silhouette-extrusion-conditioning-v0`
- Effective source route: `cpu-sdf-raymarch-rounded-extrusion-v0`
- Source receipt SHA-256: `395d1bd8b360fce33540088302e73f523098977196f8fdfa6f7fe06410a1ce9f`
- Source resolution: `192x192`
- Selected latent bodies: `prior-shape-0021`, `prior-shape-0032`, `prior-shape-0066`, `prior-shape-0087`
- Selection pressure: forked crown, narrow-waist lateral point, pendant lower mass, and near-ring negative space

Each source is an actual shallow 3D rounded silhouette extrusion with a three-quarter clay render, depth, normals, and mask. This assay uses the clay render through the currently registered single-reference Flux2 edit route.

## Imagegen Matrix

- Requested route: `gpu-greenroom/mflux_flux2_edit_promptfile`
- Effective runner: `/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit`
- Model: `flux2-klein-9b`, 4-bit
- Output: `512x512`, eight steps, guidance `1.0`
- Cells: four source bodies by three prompt stances
- Effective control levers: source gestalt, prompt stance, and seed

The route exposes no effective image-strength or ControlNet-style conditioning scalar. Flux2 Klein's distilled runner requires guidance `1.0`, so the three prompt stances are the honest adherence control:

1. `preserve-gestalt`: treat the render as the body-plan scaffold;
2. `lineage-seed`: treat it as a recognizable ancestral gesture;
3. `prior-forward`: preserve one distinctive structural event and let the organism depart strongly.

All twelve jobs completed with exit code zero through the effective Flux2 edit runner. The compact `route-receipts.json` preserves every Greenroom receipt, effective route, input hash, prompt hash, output hash, and exit state; no output lacking that receipt chain was admitted to the matrix.

| Shape | Preserve | Lineage | Prior-forward |
| --- | ---: | ---: | ---: |
| `0021` | 59.5s | 70.6s | 60.6s |
| `0032` | 79.2s | 72.2s | 56.3s |
| `0066` | 56.7s | 94.4s | 52.4s |
| `0087` | 47.3s | 44.1s | 40.2s |

Mean wall time was 61.1 seconds per image. Exact job IDs, seeds, and output directories are in `submissions.tsv`; executable and content identity are in `route-receipts.json`.

## Visual Witness

`contact-sheet-source-preserve-lineage-prior.png` is the inspected 4x4 witness. Rows are shapes `0021`, `0032`, `0066`, and `0087`. Columns are source clay, preserve-gestalt, lineage-seed, and prior-forward. SHA-256: `41835a5d4f33cac5e592cc9307a4c9609d4effe5fae0bbe4bf0d52633d066776`.

Every cell is one complete object-like organism on a neutral studio ground. None collapsed into an icon, relief, duplicate-creature composition, or severed-parts image.

The result does not support one global stance winner:

- `0021`: all three are coherent but converge toward familiar armored reptile/quadruped anatomy. Preserve pressure retains the fork most visibly as horn and plate structure.
- `0032`: prior-forward is the strongest positive departure. A weak upright source becomes a coherent low spider-like organism while retaining a forward lobe and dominant upper mass.
- `0066`: preserve-gestalt is strongest. The pendant lower mass resolves into a strange multi-contact underbody; lineage and prior-forward collapse toward more generic quadruped anatomy.
- `0087`: preserve-gestalt is strongest. The near-ring negative-space event resolves into a terminal annular mouth and creates the clearest unusual whole-body identity in the matrix.

The useful control law is per-scaffold pressure selection. More model prior increases topology departure, but it also erases the rare source event more often than it invents a better rare event. The operator or an agent judge should select pressure after seeing a small stance fanout rather than setting one global adherence mode.

## Selected Trellis Casts

Three nonredundant image cells were selected only after visual inspection:

| Cell | Why | Job | Runtime | Sparse voxels | Final triangles | GLB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `0032/prior-forward` | strongest topology jump; low spider-like body | `612443decf9e` | 126.9s | 4,183 | 148,967 | 8.8 MB |
| `0066/preserve-gestalt` | pendant mass becomes multi-contact underbody | `548249eaddfc` | 78.9s | 2,216 | 171,364 | 9.0 MB |
| `0087/preserve-gestalt` | annular terminal-mouth event | `c2b2ac211b2a` | 74.9s | 2,422 | 129,903 | 9.1 MB |

All three used `gpu-greenroom/trellis2mlx_fast` with seed `42`, six steps, no cascade, a 200,000-face target, 1024px textures, and simplify-first. The effective routes and successful receipt states bind those parameters to the three hash-addressed GLBs. Their stage logs record MLX feature extraction, sparse decoding, mesh extraction, cleanup, PBR texture decode, UV baking, and GLB output; `route-receipts.json` preserves the final sparse-voxel and triangle metrics without treating them as the visual witness.

The Blender witness jobs are recorded in `witness-submissions.tsv`. The first triplet sampled yaw `-0.85`, `0`, and `0.85`; because that arc hid the front hemisphere of the spider-like cast, a fourth `3.141593` yaw was rendered for every cast before disposition.

`trellis-contact-sheet-left-front-right-opposite.png` is the inspected 3x4 cast witness. Rows are `0032/prior-forward`, `0066/preserve-gestalt`, and `0087/preserve-gestalt`. Columns are yaw `-0.85`, `0`, `0.85`, and `3.141593`. SHA-256: `feb7ee88218e72ea5d02ba931c7299bf906153ba1a6229ffd6a9394af3727ae8`.

All twelve Blender jobs completed with exit code zero. `route-receipts.json` preserves the effective `/Applications/Blender.app/Contents/MacOS/Blender` runner, live worktree witness-script route, source GLB hash, and render hash for every yaw. The inspected geometry shows:

- `0032/prior-forward`: a coherent eight-legged double-lobed spider body. The initial arc showed its segmented rear; the opposite view proves a complete face and mouth on the hidden hemisphere.
- `0066/preserve-gestalt`: a horned armored crawler with six visible contact limbs, large anterior claws, a terminal mouth, a segmented tail, and coherent rear plating.
- `0087/preserve-gestalt`: a low layered organism whose annular source event survives as a terminal tubular mouth, with repeated lateral contacts and coherent dorsal/rear segmentation.

The casts share a material prior, but their massing, contact patterns, head structures, and locomotion implications remain materially distinct. No selected body collapses back to a common quadruped topology during Trellis conversion.

## Current Verdict

The learned silhouette prior is already useful as a body-plan proposal source. Its crude extrusions carry enough anonymous gestalt through Flux2 to select among materially different organisms, and per-scaffold prompt pressure controls whether the rare structural event survives or the model rides into a neighboring anatomy basin. Three visually selected cells then survive Trellis as coherent, inspectably different full 3D casts.

This closes the central route predicate for this slice: a sampled identity-free silhouette can act as selectable ancestry, not merely as a mask. The scaffold proposes mass and negative-space events; imagegen discovers anatomy; Trellis crystallizes the selected basin into a textured mesh while retaining the body-plan distinction.

The next model-facing lever is multi-reference conditioning, especially clay plus depth or normals. It should be assayed separately because changing both prompt pressure and reference count in this matrix would confound the current result.

## Receipt Bundle

`route-receipts.json` contains `27` compact receipt rows: twelve Flux2 edits, three Trellis casts, and twelve Blender witnesses. Every row embeds the original Greenroom receipt plus input/output SHA-256 values and effective runner identity. Flux2 rows also bind the requested absolute prompt path to the corresponding compact `prompts/` file by content hash. Trellis rows add final GLB hashes, byte sizes, sparse-voxel counts, and final triangle counts. Blender rows add the source GLB and rendered-frame hashes.

Manifest SHA-256: `b232c663f93e6db7f6293947f199205cb3171e6958d11d4756490891ee51cd8f`.
