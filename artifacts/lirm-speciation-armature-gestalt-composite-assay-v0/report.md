# LIRM Gestalt Composite Assay

## Question

Can a learned silhouette basin become actual three-dimensional conditioning structure, remain composable with a procedural creature armature, steer image generation at the level of whole-body gestalt, and survive Trellis as a coherent full-azimuth spatial cast?

## Composite Control

`lirm-speciation-gestalt-composite-witness.mjs` composes two signed-distance fields: the existing sphere/capsule/rounded-box armature and a rounded volume derived from a selected silhouette-basin mask. The result is an actual 3D implicit body with depth, normals, semantic regions, and dual lineage back to both source armatures.

The CPU assay crosses four accepted silhouette basins with gestalt pressures `0.25`, `0.46`, and `0.67`, then applies basin 10 at `0.46` to armatures 08, 16, 22, and 24. The inspected control sheets establish:

- `0.25` perturbs the procedural body while retaining most of its original envelope.
- `0.46` materially changes silhouette and mass distribution while retaining enough armature structure to carry contacts and semantic regions.
- `0.67` lets the silhouette envelope dominate and begins to erase useful armature distinctions.
- Basin 10 at `0.46` produces a related gestalt across four visibly different armatures rather than replacing them with one identical volume.

The selected first firing point is therefore `0.46`. The generator-facing `trellis-source.png` files are clean isolated clay renders; the half-grid visible in some diagnostic sheets belongs to the comparison witness and does not enter imagegen.

## Imagegen

Four basins (`03`, `10`, `15`, `22`) at pressure `0.46` were fired through Flux2 Klein 9B under two prompt stances at fixed seed `717046`. The effective route was `gpu-greenroom/mflux_flux2_edit_promptfile`, 4-bit, 512 by 512, eight steps, guidance `1.0`. All eight jobs passed requested/effective route, prompt, source, settings, freshness, output, and hash validation.

The jobs averaged 34.1 seconds and ranged from 30.8 to 41.4 seconds. `imagegen/gestalt-imagegen-contact-sheet.png` is the inspected source/depth/output witness; SHA-256: `56ac3fb775db3d28f869714b0e50e850f6840ee9d0571b416e4b6b875a3d350b`.

Visual result:

- Basin 03 becomes a bifurcated, segmented crawler with a large low frontal mass.
- Basin 10 becomes a compact low arch with strongly curled rear mass.
- Basin 15 becomes an upright bell-backed, fore-heavy body.
- Basin 22 becomes the broadest and lowest crawler in the set.
- `lineage-seed` adds eyes, contacts, plates, and stronger conventional anatomy while retaining the basin envelope.
- `preserve-gestalt` adheres more literally to unusual lobes and openings; the basin 03 pair remains recognizably related while producing different descendants.

This clears the image gate: the learned silhouette is not merely a decorative mask. Under fixed armature, seed, route, and material language, it selects visibly different whole-body image basins.

## Trellis Crystallization

Five nonredundant outputs were promoted: both basin 03 prompt stances plus lineage outputs from basins 10, 15, and 22. The effective route was `gpu-greenroom/trellis2mlx_fast`, seed `42`, 512 resolution, six steps, no cascade, 200,000 target faces, and 1024px textures.

| Cast | Runtime | GLB bytes |
| --- | ---: | ---: |
| basin 03 / preserve | 86.6s | 9,723,692 |
| basin 03 / lineage | 88.1s | 9,499,012 |
| basin 10 / lineage | 97.0s | 9,814,284 |
| basin 15 / lineage | 83.1s | 8,929,476 |
| basin 22 / lineage | 73.6s | 9,586,284 |

The five casts averaged 85.7 seconds. Durable copies live together under `trellis/glbs/`.

`trellis/gestalt-trellis-witness-contact-sheet.png` is the inspected five-row by four-azimuth witness; SHA-256: `6029fd9fdb902421de863cabd0c358722a83d5d82b93014d0e18569ed63469c0`.

- Basin 03 / preserve retains the split frontal structure, annulated body, and armored longitudinal rhythm. Its opposite side resolves as a modeled rear rather than an open image shell.
- Basin 03 / lineage remains in the same family but becomes lower, smoother, and more conventionally quadrupedal. The prompt stance therefore survives as spatial anatomy rather than surface decoration.
- Basin 10 / lineage preserves the compact arch, enlarged curled hind masses, and low four-contact stance.
- Basin 15 / lineage preserves the upright fore-heavy wedge, high shell, and long front-to-rear slope. It remains visibly distinct from basin 10 around the full azimuth turn.
- Basin 22 / lineage preserves the broadest, lowest envelope and the strongest lateral hind masses. Its hidden side is simplified but coherent.

All five casts are nonblank and coherent across left, front, right, and opposite views. No flat-card result, duplicated-view substitution, catastrophic hidden-side collapse, or gross visible hole appears in the witness. These renders establish full-azimuth coherence at one modest positive pitch; they do not establish watertight topology, riggability, production decimation, or elevation robustness.

## Route Failure Receipt

The first 20 Blender jobs used a registered route whose cwd pointed at a deleted prior worktree. Every job failed at launch before primary output. The failure is preserved in `trellis/witness-submission-report-stale-cwd-failure.json` and `trellis/witness-completion-report-stale-cwd-failure.json` and contributes no visual evidence. Route `kaminos_blender_glb_witness_molten_0718` binds the current worktree explicitly and produced the accepted witness set.

## Review And Receipt Hardening

The path-restricted automated Gemini review attempt exhausted both configured quotas and produced no review result. A read-only GPT-5.5 review over the same five authored files found four false-closure paths: stable-path input or prompt mutation, executable-prefix route spoofing, unverified Trellis hardcoded settings, and nullable timing with no output-freshness proof.

`review.md` records the findings and their dispositions. The repaired validators rehash live inputs, prompts, and witness scripts; require exact executable identity; verify Trellis's fixed command flags; require actual finite numeric and monotonic job timestamps; and require each primary output's mtime to fall inside its job window. The first revision confirmation exposed and closed a residual `null`-to-zero timestamp coercion path. The original completed jobs were replayed through the final contracts without new inference: all eight image outputs, five Trellis GLBs, and twenty witness frames passed with zero rejection.

## Verdict

The complete route works:

> learned silhouette basin -> silhouette-bounded 3D armature -> image hallucination -> coherent Trellis cast

The load-bearing result is dual survival. The procedural armature remains strong enough to carry connected volume and semantic structure, while the learned silhouette changes mass, proportion, stance, and whole-body identity. Imagegen elaborates those controls into plausible anatomy, and Trellis crystallizes the selected differences into coherent spatial objects.

The current evidence covers one source armature in the generator matrix, four learned basins, one image seed, one shared material language, two prompt stances, and one Trellis configuration. The next discriminating experiment is a controlled two-axis fanout: several armatures crossed with several basins at pressure `0.46`, followed by a small adherence/prior matrix over the generator's actual conditioning controls. Generator-facing prompts can use ordinary product-render and fictional-creature vocabulary; the internal speciation, morphology, armature, and basin ontology remains unchanged.
