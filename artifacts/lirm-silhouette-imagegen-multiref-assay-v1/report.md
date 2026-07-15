# Multi-Reference Creature Conditioning Assay v1

## Question

When body, prompt stance, seed, model, resolution, steps, and guidance are held fixed, how do depth and normal references change Flux2's interpretation of a crude but real three-dimensional morphology scaffold?

The load-bearing comparison is not image quality alone. It is whether extra geometric references provide a useful control over scaffold retention versus anatomical invention without collapsing the output into an icon, duplicate composition, severed organism, or generic shared body plan.

## Source And Fixed Controls

- Source route: `kaminos/lirm-speciation-armature/silhouette-extrusion-conditioning-v0`
- Effective source route: `cpu-sdf-raymarch-rounded-extrusion-v0`
- Source receipt SHA-256: `395d1bd8b360fce33540088302e73f523098977196f8fdfa6f7fe06410a1ce9f`
- Source bodies: `prior-shape-0032`, `prior-shape-0066`, and `prior-shape-0087`
- Reference sets: clay only, clay plus depth, clay plus normals, and clay plus depth plus normals
- Model: `flux2-klein-9b`, 4-bit
- Output: `512x512`, eight steps, guidance `1.0`
- Effective runner: `/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit`

Each row fixes the prompt stance and seed used by its earlier single-clay control. The only changed input is the reference set. Shape `0032` uses the `prior-forward` stance and seed `715323`; shapes `0066` and `0087` use `preserve-gestalt` with seeds `715661` and `715871` respectively.

`contact-sheet-clay-depth-normal.png` is the inspected 3x4 witness. Rows are `0032`, `0066`, and `0087`. Columns are single-clay control, clay plus depth, clay plus normals, and clay plus depth plus normals. SHA-256: `58a7844ac0ea9ed96b7387520de142a631af2785615f51287d4017abe79343c5`.

## Runtime Matrix

All nine new jobs completed with exit code zero. Every admitted output is bound to its exact Greenroom request, effective route, reference ordering, prompt, seed, model, dimensions, steps, guidance, and output hash in `route-receipts.json`.

| Shape | Clay + depth | Clay + normals | Clay + depth + normals |
| --- | ---: | ---: | ---: |
| `0032` | 52.9s | 55.2s | 79.7s |
| `0066` | 93.7s | 71.3s | 72.1s |
| `0087` | 77.8s | 76.7s | 90.0s |

One malformed submission, job `f4c8e072077b`, repeated the `-p` flag and therefore retained only `mlx_cache_limit_gb=48`. It was cancelled before dispatch, excluded from the matrix, and replaced by correctly parameterized job `4ea0e6341688`. `experiment.json` binds both job IDs and replacement cell `0032/clay-depth`; the contract rejects the malformed job and requires that exact replacement identity in both the receipt manifest and submissions table.

## Visual Disposition

Every matrix cell is one complete coherent organism. None is blank, duplicated, severed, icon-like, or merely a relief. The reference channels produce real but scaffold-dependent changes.

### `0032`: strongest reference-channel traversal

The single-clay control rides the prior into a low spider-like organism. Clay plus depth pulls the body back toward the upright two-lobed source and produces four strong contacts. Clay plus normals retains more of the source orientation while permitting greater appendage and facial invention. Clay plus depth plus normals remains source-like but resolves long organic contacts.

This row provides the clearest evidence that the reference set can move Flux2 between neighboring body-plan basins while seed and prompt remain fixed.

### `0066`: cleanest combined-control organism

The single-clay control is a broad bug-like crawler. All three multi-reference cells converge on an armored quadruped or larval-mammal lineage. Depth favors lower horns and plates. Normals produce higher horns and more facial invention. Depth plus normals produces antennae, a coherent armored torso, and the strongest complete anatomy in the row.

The combined cell is the best high-coherence downstream candidate, though this row also shows that stronger geometric conditioning can select a familiar model-prior lineage rather than preserve every rare source event literally.

### `0087`: strongest scaffold lock, lowest marginal diversity

The single-clay control is a low many-legged organism with an annular terminal mouth. All three multi-reference cells converge on a coherent armadillo- or pig-like organism with a tubular mouth. Depth, normals, and their combination alter limbs and tusks, but the lineage remains materially the same.

This is positive evidence for stable scaffold control and negative evidence for spending three Trellis runs on visually redundant variants.

## Control Law

The current evidence supports four practical rules:

1. Single clay allows the largest model-prior departure.
2. Depth supplies the strongest whole-shape lock.
3. Normals retain broad body-plan structure while allowing more local anatomical invention.
4. Depth plus normals usually preserves silhouette while selecting coherent contact anatomy, but the magnitude and direction of the effect depend on the source scaffold.

There is no global best reference set. A small reference fanout is currently the honest selection surface. The operator or an agent judge should choose per scaffold according to the desired balance between rare-event retention, topology departure, and anatomical coherence.

## Selected Trellis Casts

Two cells answered different downstream questions and justified 3D compute:

- `0066/clay-depth-normal`: tests whether the cleanest combined-reference organism survives as a coherent full cast.
- `0032/clay-normal`: tests whether the most permissive geometric channel retains a deliberately strange scaffold while preserving useful anatomical invention.

The `0087` multi-reference cells are withheld because their visible deltas are too redundant to justify separate casts. The `0032/clay-depth-normal` cell is also withheld because `0032/clay-normal` tests the sharper invention-versus-control boundary.

Both used the comparable `gpu-greenroom/trellis2mlx_fast` route: seed `42`, six steps, no cascade, 200,000 target faces, 1024px textures, and simplify-first.

| Cell | Job | Runtime | Sparse voxels | Final triangles | GLB bytes | GLB SHA-256 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `0032/clay-normal` | `1d945dfb0771` | 296.9s | 3,785 | 182,035 | 9,410,972 | `fbb23ebda4be88fb84373183f8f38cf2526785ed6bc920fdc2491e3c9aa06bbf` |
| `0066/clay-depth-normal` | `3475f77bdec9` | 253.0s | 2,440 | 149,066 | 9,998,996 | `73b96596d6107fcc55dd487a3028b23c9f315043d0210a359bfcaa2e293a7356` |

Both jobs completed with exit code zero and no route warnings. The `0032` input produced 55% more sparse tokens than `0066`, then incurred larger shape decode and UV-unwrapping stages; the runtime difference is therefore coupled to geometric complexity rather than a route or settings change.

## 3D Visual Witness

Eight Blender jobs rendered yaw `-0.85`, `0`, `0.85`, and `3.141593` for the two casts. They used the lane-scoped `gpu-greenroom/kaminos_blender_glb_witness_molten_0715` route because the older shared route still named a removed worktree. The scoped receipts prove the current recovery worktree, current witness script, effective Blender executable, source GLB hash, render hash, and successful exit for every view.

`trellis-contact-sheet-left-front-right-opposite.png` is the inspected 2x4 witness. The top row is `0032/clay-normal`; the bottom is `0066/clay-depth-normal`. Columns are left, front, right, and opposite. SHA-256: `35ae92f4816c8dd0d1b8aead3734ee1cad0644ebf660ee95f043826634de357c`.

- `0032/clay-normal` becomes a complete big-headed crawler with an asymmetric spider-like contact plan, two large eyes, a terminal mouth, small forward feet, and long lateral contacts. The rear is simple but closed and coherent. Its unusual balance between a bulbous upright mass and low radial locomotion survives Trellis.
- `0066/clay-depth-normal` becomes a materially distinct armored horned quadruped with antennae, dorsal plates, inset side panels, broad front feet, a terminal mouth, and a complete plated rear. Its combined-reference body plan survives without collapsing into the `0032` topology.

The two casts share Trellis's material prior, but not a body plan. The permissive normal channel supports substantial anatomical invention in `0032`, while depth plus normals gives `0066` stronger conventional structural lock. This is the downstream confirmation the image matrix required.

## Verdict

Multi-reference conditioning is a live control surface for the creature crucible. Clay alone is useful when the model prior should roam; depth can pull the result back toward whole-shape events; normals permit more local anatomical invention; and depth plus normals can produce a highly coherent locked organism. The useful setting still depends on the scaffold, so small per-body reference fanouts remain indicated.

More importantly, both selected image basins survive crystallization into complete and visibly different 3D organisms. This closes the route predicate for the slice: a crude semantic morphology can be elaborated under controllable reference pressure and still retain its selected body-plan distinction through Trellis.

## Receipt Bundle

`route-receipts.json` contains nine compact image-generation receipts and requests. It records the exact semantic role and hash of every reference image, prompt path and hash, output path and hash, effective runner, runtime, status, and failure state. The three clay-only controls are revalidated against their hash-bound prior receipt manifest, including input, prompt, route settings, output, status, and failure state.

`trellis-stage-receipts.json` contains the two Trellis and eight Blender receipt/request pairs. It records input and output hashes and byte sizes, effective route identity, status, failure state, sparse-voxel and final-triangle metrics, view identity, and yaw.

- Image route-receipt manifest SHA-256: `c506acb8c0a9310a053e845a24a031eed97edaa2f747fe1643a81b8e8e1b76e8`
- Trellis-stage receipt manifest SHA-256: `935013ddc53e5fe683079618477ade3019104e30e227b859eb56f7aeae716c7f`
- Experiment manifest SHA-256: `601f0a96d0e496bfa402c9a2ec2d4e8275940cbed8194844e489e47ee950ca3a`
- Contact-sheet SHA-256: `58a7844ac0ea9ed96b7387520de142a631af2785615f51287d4017abe79343c5`
- Trellis contact-sheet SHA-256: `35ae92f4816c8dd0d1b8aead3734ee1cad0644ebf660ee95f043826634de357c`
