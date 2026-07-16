# Source 0032 Sparse-Guidance Identity Bracket

## Question

At what sparse-structure guidance pressure does Trellis recover the source creature's body-plan identity while retaining useful hallucination?

The load-bearing source traits are a compact cephalopod-like crawler, paired giant eyes, an open mouth, a bulbous upright mass, and low radial locomotion organized around several clawed or tentacular contact limbs.

## Effective Route

All three rows used the same source image, seed 42, six steps, 512 structured-latent resolution, no cascade, simplify-first cleanup, a 200,000-face target, and 1K textures. Sparse guidance rescale remained 0.7 over `[0.6, 1.0]`; downstream shape guidance remained 7.5 with rescale 0.5 over `[0.6, 1.0]`. Only sparse guidance strength changed: 1.00, 2.00, and 4.00.

Every generation and camera witness passed exact job-type, effective-cwd, effective-route, request, exit, and PNG evidence admission. `route-receipts.json` carries those records. One accidental duplicate CFG 2.00 left witness, job `7846c3d4b3a3`, is explicitly excluded in favor of admitted job `19bea65b5bc7`.

## Visual Read

### CFG 1.00

This is a connected broad body with a tall rear sheet and low claws. It preserves the general idea of a top-heavy animal close to the ground. It loses the giant eyes, paired facial organization, open mouth, compact crawler silhouette, and radial contact ring. This row is coherent enough to use as a prior-heavy invention, but it does not preserve source identity.

### CFG 2.00

This is the first partial identity recovery. It forms a compact low crawler with one unmistakable giant eye and appendages distributed around the body. The right and rear views read as one creature, although detached curved pieces remain. The paired face and open mouth do not resolve; the facial cavity reads as a damaged trunk or socket. CFG 2.00 materially crosses from generic inspiration into source-related anatomy, but the complete identity carrier set is absent.

### CFG 4.00

This is the first multi-carrier structural hit. It recovers a compact upright cephalopod-like mass, two visible eyes, and a broad low radial ring of tentacular or clawed limbs. The model still invents substantially: the mouth becomes a looped horn-like opening, the silhouette shifts by view, and some appendage joins are broken or detached. The result preserves source identity without becoming a literal reconstruction.

## Decision

The useful identity threshold lies between sparse guidance 2.00 and 4.00 for this source and route. CFG 2.00 is a partial recovery; CFG 4.00 is the first convincing body-plan recovery. A CFG 3.00 midpoint is the next indicated run because it can locate where paired facial structure and radial locomotion return without spending another broad matrix.

This result supports exposing sparse-structure guidance as a crucible handle. Low pressure can ask Trellis to invent from an armature; higher pressure can preserve a selected creature identity. The handle is continuous enough to be useful, and the threshold is source-dependent enough that it needs visible receipts rather than a hidden default.

## Timing And Geometry

Generation took 51.8 seconds at CFG 1.00, 69.0 seconds at CFG 2.00, and 61.0 seconds at CFG 4.00 under observed shared-box conditions. Final meshes remained near the fixed 200K target. Sparse occupancy rose from 590 voxels at CFG 1.00 to 1,189 at CFG 2.00 and 1,362 at CFG 4.00; that supports the visual transition but does not substitute for it.

## Artifacts

- `0032-identity-bracket-contact-sheet.png`: twelve admitted views, arranged by guidance pressure.
- `experiment.json`: source identity, fixed controls, route identity, contact-sheet hashes, and assembly manifest.
- `route-receipts.json`: requested and effective routes, Greenroom receipts, geometry metrics, camera contracts, and visual-evidence metrics.
- `build-assay.mjs`: re-runnable file-in/file-out assembler with fail-loud route and image admission.
