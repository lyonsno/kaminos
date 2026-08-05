# Domestic Cat Skeleton Positive-Control Shortlist

## Decision

Request the assembled 3D Anatomy Studios Blender scene first. In parallel, inspect the downloadable Tavernier Amaury photogrammetry archive as the immediate fallback. Do not spend operator time manually reconstructing a second feline skeleton unless both acquisition paths fail.

Both shortlisted sources were visually screened **happy / safe**. This is a source-ranked shortlist, not certification of anatomical accuracy, downstream publication rights, archive topology, object hierarchy, or preserved scale.

## 1. 3D Anatomy Studios Complete Cat Skeleton

**Disposition:** strongest positive control; acquire first.

- Canonical source: [Digital Rendering of a Complete Cat Skeleton](https://3danatomystudios.com/portfolio/digital-rendering-of-a-complete-cat-skeleton/)
- Underlying project: [MorphoSource project 000344158](https://www.morphosource.org/projects/000344158)
- Institution and authorship: 3D Anatomy Studios; segmentation and assembly by J.D. Laurence-Chasen; editing and rendering by Aaron Olsen; CT acquisition used the Keck XROMM Core Facility.
- Specimen: MorphoSource physical object `000360672`, `3DAS:00001`, recorded as *Felis catus*. It is a biological specimen but not a vouchered museum specimen.
- Geometry: CT-derived segmentation plus authored articulation. Individual bones were segmented, incomplete source anatomy was supplemented, and the result was assembled in Blender.
- Completeness and pose: published as a complete articulated skeleton in a coherent neutral standing or crouched presentation.
- Components: per-bone separation is strongly suggested by the production method but remains unverified until the source scene is obtained.
- Scale: the CT is calibrated in millimeters; scale preservation in the assembled scene remains unverified.
- Access and license: the model page states CC BY-NC-SA. The underlying MorphoSource CT records are open for noncommercial use under the MorphoSource Standard agreement, including derivative-archiving requirements. This is source reporting, not legal advice.
- Blender usability: potentially excellent if the assembled scene is provided; poor to moderate if only the raw CT can be obtained.
- Visual screen: happy / safe; conventional clean articulated skeleton with no soft tissue or hostile framing.

### Acquisition Request

Contact `contact@3danatomystudios.com` and request the Blender scene or per-bone segmented meshes, preserving original units and object separation. Ask whether internal noncommercial generator-assay use is authorized under the published terms and whether supplemental skull or repaired limb elements are identified in scene metadata.

> We are conducting an internal, noncommercial research assay on whether anatomically specific skeletal structure produces corresponding taxonomic fidelity in generated creature geometry. Could you share the Blender scene or per-bone segmented meshes used for “Digital Rendering of a Complete Cat Skeleton,” with original units and bone-object separation preserved? We would not publicly redistribute the source asset. We would also appreciate any notes identifying supplemental or reconstructed elements, especially the skull and incomplete limb regions.

## 2. Tavernier Amaury Complete Cat Skeleton

**Disposition:** immediate downloadable fallback and comparative control.

- Canonical source: [Cat Skeleton by Tavernier Amaury](https://sketchfab.com/3d-models/cat-skeleton-7106115b299649e992476f2d3b4fc602)
- Author: Tavernier Amaury, France.
- Geometry: photogrammetry scan of a physical complete cat skeleton.
- Completeness: skull, axial skeleton, pelvis, scapulae, limbs, feet, and tail are broadly represented. Some small elements appear incomplete, obscured, or merged into the mount.
- Pose: mounted standing or walking pose rather than a clean neutral anatomical pose.
- Components and scale: likely fused photogrammetry geometry; object separation and trustworthy real-world scale are unverified.
- Format: downloadable through Sketchfab; original archive format must be verified during acquisition. Converted glTF or GLB availability is likely.
- License: CC BY-NC-SA on the canonical author page.
- Blender usability: likely immediate for silhouette and generator assays; substantially weaker for joint analysis, per-bone manipulation, or ecorche attachment.
- Authentication weakness: no institution, specimen number, veterinary provenance, or taxonomic record beyond the author description.
- Visual screen: happy / safe; conventional mounted skeleton with no soft tissue or hostile presentation.

## Conditional Reconstruction Route

If the 3DAS assembled scene cannot be obtained, its raw CT is authoritative enough to justify reconstruction but is not the efficient first move.

- Rostral CT: [MorphoSource media 000360675](http://n2t.net/ark:/87602/m4/360675)
- Caudal CT: [MorphoSource media 000360846](http://n2t.net/ark:/87602/m4/360846)
- Format: CT/DICOM image series at approximately `0.444432 mm` voxel spacing and slice thickness.
- Coverage: rostral scan covers the head through the sixth lumbar vertebra; caudal scan covers the last thoracic vertebra through the tail.
- Defects: the rostral scan loses part of one forelimb; the caudal scan loses portions of knees and a foot. The published complete assembly used supplemental material.
- Cost: segmentation, registration, gap repair or mirroring, cleanup, and articulation are required before Blender use.

## Rejection Ledger

- [University of Edinburgh domestic cat](https://open.ed.ac.uk/3d-skeletons-and-skulls/): institutional, CT-derived, and CC BY, but skull-only.
- [DigiMorph *Felis sylvestris catus*](https://digimorph.org/specimens/Felis_sylvestris_catus/): canonical University of Texas CT source, but head or skull-only.
- [RISD Nature Lab domestic cat skull](https://sketchfab.com/3d-models/domestic-cat-skull-bb6b8398029c45ef9da4e4ff04d2d9d9): institutional Artec scan, but skull-only.
- [Westerly Feline Skeleton](https://sketchfab.com/3d-models/feline-skeleton-dec-a5d0bb8f55dc4f49b103cd20d65e0b17): clean and complete-looking, but explicitly a first-practice authored ecorche without specimen provenance.
- [Yacine Brinis cat skeleton](https://sketchfab.com/3d-models/cat-skeleton-3d-model-1286221f365a40c9b0ca88141b124bc8): complete-looking marketplace geometry with visibly stylized proportions and no authentication.
- [St Andrews domestic cat skeleton](https://collections.st-andrews.ac.uk/item/felis-domesticus-skeleton-domestic-cat/1011940) and [Horniman NH.0.454](https://www.horniman.ac.uk/object/NH.0.454/): credible physical specimens without downloadable 3D geometry.
- Zenodo, Figshare, and Dryad searches surfaced domestic-cat cranial CT datasets but no independent downloadable whole-body skeleton suitable for this assay.

## Program Consequence

The current authored bauplan is the right object for discovering a controllable morphology grammar. An authenticated whole cat skeleton is a different instrument: a positive control for whether stronger species-specific source geometry increases feline convergence under otherwise matched generator conditions. Acquiring it does not replace the authored program and should not block the next prompt-axis assays.
