# Silhouette Archetype to Organism Basin Assay

## Question

Can a large corpus of existing character silhouettes provide useful morphology priors without asking an image generator to reproduce any source character, and can novel identity-free silhouette mixtures drive imagegen toward coherent organism basins through actual 3D structure?

## Route

1. Acquire 1,025 official-artwork PNGs from the declared PokeAPI sprite repository URLs.
2. Record requested/effective URL, source dimensions, content type, and source-content SHA-256.
3. Extract alpha only, tightly frame it, canonicalize it to 128x128, and derive a signed distance field.
4. Withhold source identity and source appearance from the trainable representation. Source image bytes are not written to the corpus artifact.
5. Partition the corpus by measured foreground-component and hole topology.
6. Fit local SDF-PCA neighborhoods and generate three kinds of candidates: local-neighbor interpolation, local-component push, and local-centroid mutation.
7. Compare every candidate against every source mask and its horizontal mirror. Reject candidates with canonical-mask IoU at or above 0.94.
8. Turn selected accepted masks into actual rounded 3D silhouette-extrusion SDFs, then CPU-raymarch clay, depth, normal, and mask controls.
9. Fire the clay render through the known-good Greenroom Flux2 edit route under two prompt stances: preserve gestalt and loose lineage seed.
10. Accept no image until its Greenroom receipt proves the effective route and a non-empty `output.png` exists.

## Corpus evidence

- Requested sources: 1,025
- Accepted sources: 1,025
- Failed sources: 0
- Unique source-content hashes: 1,025
- Unique derived silhouette hashes: 1,025
- Source bytes retained in the artifact: no
- Trainable representation: canonical binary mask, signed distance field, topology, anonymous shape hash
- Most common topology classes: 322 one-component/no-hole; 169 one-component/one-hole; 110 one-component/two-hole; 92 one-component/three-hole

The rasterized corpus witness is `../lirm-silhouette-archetype-corpus-pokeapi-full-v0/contact-sheet.png`. It was visually inspected and contains broad silhouette coverage: bipeds, quadrupeds, serpents, rays, birds, insects, radials, slugs, branching bodies, floating multipart bodies, and compact mascot masses.

## Shape-space evidence

The first global PCA assay produced genuine interpolation but collapsed the corpus toward generic centered mascot masses. That result is informative but unsuitable as the primary generator.

The topology-local assay trained on all 1,025 SDFs and generated 96 candidates:

- accepted downstream: 89
- rejected as too source-similar: 7
- accepted copied candidates: 0
- cross-topology parent pairs: 0
- candidates whose decoded topology changed: 71
- random seed: 713
- requested neighborhood size: 16
- requested local components: 10

The witness `../lirm-silhouette-local-shape-space-pokeapi-full-v0/contact-sheet.png` was visually inspected. It preserves substantially more silhouette vocabulary than global PCA and produces useful novel stalks, slabs, quadrupeds, rays, curled bodies, radial insects, jellyfish roots, slugs, birds, ribbons, and multipart forms.

## Actual 3D bridge

Eight diverse accepted candidates were rendered as rounded silhouette-extrusion SDF volumes at 192x192. Each conditioning packet records:

- exact generated-mask SHA-256;
- parent anonymous shape hashes;
- nearest-source novelty assay;
- actual 3D volume kind, thickness, roundness, and camera;
- nonflat depth-level and field-gradient normal-color counts;
- clay, transparent-clay, depth, normal, and mask paths.

The clay/depth/normal/mask contact sheets in `../lirm-silhouette-extrusion-conditioning-pokeapi-v0/` were visually inspected. They are coherent three-quarter volumes rather than masks relabeled as depth or normals. The crude extrusion sidewalls retain visible SDF strata, which is acceptable for this assay because the next model is being asked to elaborate structure rather than preserve surface finish.

## False-closure incidents caught

### Binary PGM dynamic range

The in-memory SVG/contact-sheet path looked correct while the PGM writer initially emitted foreground byte value `1` instead of `255`. A byte-level fail-first assertion caught the mismatch. The writer now emits canonical `0`/`255` binary PGM data.

### Greenroom `done` without a primary image

The first 16 submissions repeated `-p` for each Greenroom parameter. The CLI accepts one parameter list, so only the final list survived and `{prompt_file}` remained unsubstituted. The mflux wrapper printed a missing-prompt error but exited zero; Greenroom therefore recorded `done` while no `output.png` existed. Primary-output validation rejected all 16 cells. The preserved diagnosis and receipts live under `failed-attempt-1/`.

The corrected invocation passes all `key=value` values after one `-p`. The first corrected smoke produced a route-verified image in 58.8 seconds and visibly converted a crude radial extrusion into a coherent armored ground organism while preserving the dominant body sweep.

One later cell (`local-shape-069/lineage-seed`) wrote an image before the shared worker disappeared. Stale recovery correctly marked the receipt failed. That image is preserved as `untrusted-stale-recovery-output.png`, excluded from the matrix, and replaced by an exact rerun with a successful receipt (`cdf14be98494`).

## Imagegen matrix

- Route: `gpu-greenroom/mflux_flux2_edit_promptfile`
- Effective runner: `/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit`
- Model: Flux2 Klein 9B, 4-bit
- Resolution: 512x512
- Steps: 8
- Guidance: 1.0
- Cells: eight 3D scaffolds x two prompt stances
- Seeds: deterministic from shape id and stance

All 16 accepted cells have successful Greenroom receipts, exact effective routes, and non-empty primary images. The accepted inference time was 850.0 seconds total:

- all cells: 53.1 seconds mean, 41.2 seconds minimum, 70.8 seconds maximum;
- preserve-gestalt: 53.0 seconds mean across eight cells;
- lineage-seed: 53.3 seconds mean across eight cells.

The two triplet witnesses are `contact-sheet-004-031.png` and `contact-sheet-043-073.png`. Each row is source clay, preserve-gestalt, then lineage-seed. Both were inspected at original resolution.

## Visual discriminator

The matrix establishes two useful and visibly distinct controls:

- `preserve-gestalt` generally retains gross massing, directional sweep, major negative spaces, and the scaffold's appendage distribution while inventing coherent anatomy;
- `lineage-seed` treats the scaffold as an ancestral gesture and rides farther into the model prior, frequently resolving into a coherent fantasy quadruped with less literal silhouette adherence.

Neither stance collapsed into icons or relief symbols. Every accepted cell is an object-like organism on a neutral ground plane. The model prior is strong enough to invent mouths, contact limbs, armor, segmentation, and material transitions from intentionally crude 3D stimuli.

The clearest downstream candidates are:

1. `local-shape-004/preserve-gestalt`: strongest production-like coherence, terminal mouth, armored sweep, and stable ground contact;
2. `local-shape-043/preserve-gestalt`: strongest genuinely strange multi-lobed body while retaining the source's split masses;
3. `local-shape-073/preserve-gestalt`: strongest plate-stack/crocodilian departure with a non-generic silhouette.

These three cells completed through Greenroom `trellis2mlx_fast` at six steps, 200,000 target faces, and 1024px textures. The effective runner was the local native-MLX `/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py` route. The native MLX route does not use the torch/MPS attention-backend environment addressed by the Greenroom `sdpa` scar; each receipt and stdout prove MLX feature extraction, sparse decoding, mesh extraction, PBR texture decoding, UV baking, and GLB output.

| Input | Greenroom job | Wall time | Final triangles | Sparse voxels | GLB bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| `local-shape-004/preserve-gestalt` | `01817b8991cc` | 295.4s | 176,393 | 1,561 | 10.4 MB |
| `local-shape-043/preserve-gestalt` | `d3c2c2805f66` | 310.9s | 156,233 | 5,489 | 10.5 MB |
| `local-shape-073/preserve-gestalt` | `84e1493eac62` | 170.1s | 184,568 | 2,972 | 9.7 MB |

Nine Blender views were then rendered through the registered Greenroom `kaminos_blender_glb_witness` route. The route smoke `b23df74e5ed3` and all eight follow-up jobs completed with exit code zero and exact effective Blender command receipts. The inspected witness is `trellis/witness/contact-sheet.png`; each row is one cast at yaw -0.85, 0, and +0.85 radians.

The cross-shape result is stronger than generic object coherence:

- shape 004 resolves as a long armored lizard/armadillo with a terminal mouth, dorsal plates, stable contact limbs, and a curved tail;
- shape 043 resolves as a radial crustacean-like organism with antennae, split body masses, and a materially different contact pattern;
- shape 073 resolves as a low plated beetle-mammal whose layered shell remains its dominant silhouette event.

The three casts share a coherent material and creature-design prior, but they do not collapse to one body plan. Anonymous silhouette topology survives both imagegen and Trellis strongly enough to steer gestalt, while the learned priors supply anatomy, articulation, and finish. This satisfies the assay's central predicate for a first speciation armature: crude generated shape can function as selectable ancestry rather than merely as a segmentation mask.

## Learned Silhouette Prior

The two identity-free full corpora were subsequently combined into a 2,421-shape SDF dataset and used to train three small MLX convolutional VAEs. An inverted witness decode initially assayed the background complement; the saved fields were reassayed immutably using the corpus's actual positive-inside convention.

The corrected visual and receipt evidence is under `../lirm-silhouette-latent-model-assay-v0/`. Beta `0.01` is the first demonstrated globally sampleable organism-silhouette prior: all 16 direct prior samples, all 16 posterior mutations, and all 16 posterior interpolations were usable, non-copy silhouettes. Beta `0.001` retains more extreme morphology around known seeds but fails direct global sampling because all 16 prior samples contact the image frame. Beta `0.05` samples reliably but visibly compresses the corpus toward blander rounded masses.

This closes the next upstream gap exposed by the imagegen/Trellis assay. The crucible can now harvest anonymous silhouette archetypes, learn an identity-free body-plan manifold, sample or mutate within it, convert selected masks into actual 3D controls, and fire those controls into models that hallucinate anatomy and finish.
