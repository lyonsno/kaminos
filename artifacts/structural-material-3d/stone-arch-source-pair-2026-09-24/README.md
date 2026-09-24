# Stone Arch Source Pair

Two candidate source images for a continuous brittle-material fracture witness. Both show one intact, freestanding arch with a through-opening, visible depth, and a slimmer left support. The second image was edited from the first to add one outer-shoulder cutout. They are source images, not structural meshes or evidence of fracture behavior.

| Candidate | File | SHA-256 | Intended geometric distinction |
| --- | --- | --- | --- |
| Baseline | `stone-arch-intact.png` | `d78e538184c9483345466a545dd43afc942987130ab14c594cac9c44ed65cc22` | Continuous crown and asymmetric support widths. |
| Notched | `stone-arch-outer-notch.png` | `db37aafce3ebdff993665f3cc110b480f8518580ae845ac53a69a33442562f63` | One deep cutout through the outer upper-left shoulder. |

Both PNGs are 1448 x 1086 pixels. Generated on 2026-09-24 with the built-in `image_gen` tool. The notched edit also changed some fine surface texture; it is a shape candidate, not a pixel-controlled material pair. An earlier edit with an inner-edge notch was rejected because the cut was too subtle to depend on for reconstruction.

## Source Prompts

Baseline:

> Create one photorealistic source image for image-to-3D reconstruction of a physical fracture-test object. Subject: a single freestanding, intact arch made from one continuous body of dense light-gray fired ceramic or limestone, not assembled blocks. Roughly tabletop scale, 40 cm wide, 30 cm tall, 10 cm deep. One large clean open passage under a thick curved top. The left support and left springing are visibly slimmer than the right support, creating a plausible asymmetric load path, but the arch is still sturdy and upright. Plain matte granular material with subtle real surface imperfections, no painted markings, no existing cracks. Show the whole object clearly in a three-quarter front view, seeing the front, right side, interior opening, and actual depth; eye-level camera slightly above the object. Neutral mid-gray seamless studio backdrop, diffuse even light, crisp edges, natural contact shadow. Keep the arch centered with generous margin on all sides. One object only. No base, pedestal, floor tiles, tools, hands, debris, text, labels, fantasy ornament, bricks, mortar seams, or dramatic atmosphere. The geometry and material should read clearly enough for a 3D reconstruction model to recover the opening, wall thickness, and support asymmetry.

Notched edit, with the baseline image as input:

> Use the supplied image as the exact base product photo. Preserve the stone arch's overall outline, arch opening, support widths, physical depth, color, original matte granular texture, studio camera, soft lighting, shadows, and gray background. Make ONLY one large, unmistakable geometric edit for a controlled fracture-test variant: carve a single deep U-shaped rectangular notch downward from the OUTER TOP EDGE of the arch on its upper-left shoulder, about one quarter of the way from the left edge to the crown. The cut is about 7 cm wide and 5 cm deep relative to a 40 cm wide arch. Remove that solid stone all the way through the arch's front-to-back thickness, with stone-colored cut faces visibly exposed. The notch must interrupt the OUTER SILHOUETTE and leave the arch standing whole; this is a manufactured cutout, not a crack, added chunk, protrusion, stain, or dark painted line. Do not change the inner opening. Keep the source photo clean and sharply readable for single-image 3D reconstruction. No text, props, debris, base, extra object, or bricks.

## Reconstruction Check

The first mesh pass should preserve the through-opening, actual front-to-back depth, continuous left and right supports, and the notched candidate's missing outer-shoulder volume. Inspect front and oblique views before using either mesh for a structural experiment. A notch present only in texture does not count. The source pair alone cannot establish material parameters, interior volume, collision, support conditions, or a fracture path.

## TRELLIS First Pass

Submitted 2026-09-24 to the default GPU Greenroom queue, FIFO behind an existing job. Completion was registered with two `greenroom_job_watch.py --json --notify` sessions; terminal authority is each queue job's `status.json`, not this submission note.

| Source | Job ID | Output directory |
| --- | --- | --- |
| Baseline | `6239f4910433` | `trellis-intact/` |
| Notched | `bf12b4619d49` | `trellis-outer-notch/` |

Both requested `trellis2mlx` with a source worktree at revision `cddaf3cb8a9f28956114956ebe754d6661a3f695`. The effective first-job arguments recorded by Greenroom were `generate.py --image <source PNG> --output <output directory>/output.glb --seed 42 --resolution 512 --steps 12 --target-faces 200000 --texture-size 1024 --simplify-first`. The route's `--simplify-first` cleanup is a preview-continuity path, so a plausible first mesh is not yet a quality or geometry-correctness verdict. Confirm effective command and completion independently for the second job.

Both jobs completed with exit code 0 on the same effective route; see each `greenroom-status.json` and `greenroom-stdout.log`. Greenroom reported 583.9 s for the intact mesh and 524.5 s for the notched mesh. The GLB SHA-256 hashes are `c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5` (intact) and `8072e0226b19283ec26919ddf6da02ea71036423479ad7336272eaf427ccf594` (notched).

Kaminos `mesh-asset-link` witnessed both GLBs on the current asset-viewer route. Each `view-report.json` records the requested/effective read route, registered scene object, browser resource, and capture; `view.png` is the inspected frame. Both front views show an open passage. The notched GLB shows the missing outer-shoulder volume in geometry: across the x interval `[-0.15, -0.10)`, the highest vertex is y `0.236` versus `0.366` for the intact GLB. This full-mesh maximum includes all depths, so there is no high rear bridge hidden behind a front-only notch in that interval. The face counts are 209,484 and 208,313 respectively. Neither mesh is watertight (`trimesh` 5.1.0), and neither has a structural interior, collision proxy, boundary conditions, or calibrated material law. This is evidence for shape-conditioned reconstruction and a candidate *visual* carrier, not a solver-ready continuous brittle volume or fracture result.

The paired generation is not a controlled mechanical ablation: the edited source also drifted in fine texture and TRELLIS reconstructed each image independently. The first geometry-conditioned structural pass now lives in [`arch-proxy-witness/README.md`](arch-proxy-witness/README.md). It derives shared-bounds 48 x 36 occupancy profiles from the GLB triangle projections, extrudes each into a 3-layer spring graph, and applies the same foot supports, crown contact, force ladder, and fracture rule. The notched proxy begins cracking at force 0.50 while the intact proxy does not; at force 0.75 the crack set localizes into the notched upper-left shoulder; at force 2.00 the notched graph separates into two components while the intact graph stays connected. Bind restores both graphs without resetting nodal displacement.

This is evidence that a compact expressive structural graph can consume a geometry-derived shape difference and return a different causal damage path. It is not evidence of exact stone mechanics or imported-GLB fracture. The next discriminator is a mesh-derived through-depth proxy that preserves local thickness and actual notch faces, plus post-break re-equilibration; retain the present CPU solver as the comparison oracle before moving that representation into the resident GPU sidecar.
