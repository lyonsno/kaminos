# Two-Cast Support-Atlas Admission Assay V0

This assay asks whether the exact post-generation contact-atlas rule accepted
for cast `719024` can recover four terrain-support carriers on a nearby,
aesthetically positive cast without per-vertex or per-leg authoring.

## Result

| Cast/pass | Classification | Authored information |
| --- | --- | --- |
| `motion-ready-719024` control | `admit` | Existing crawler body frame and four support roles |
| `heavy-seed720201-default` | `needs-edit` | Same body frame and inherited `front t=0.75`, `rear t=0.25` windows |
| `heavy-seed720201-front-recentered` | `admit` | One paired fore-support recenter from `t=0.75` to measured `t=0.62` |

The control proposal reproduces every accepted contact vertex and influence
membership exactly. The pressure cast preserves four-way contact and rigid-core
separability, but the inherited fore windows initially clip both fore support
clusters at their posterior boundary. One shared axial recenter admits the
pressure cast. No side-specific edit, per-leg paint, vertex selection, carrier
surgery, or mesh modification was used.

The result supports a constrained generalization claim: within this positive
four-support Trellis basin, an authored crawler frame plus four support roles is
sufficient to derive usable contact effectors and lower-appendage carrier
regions with at most one paired axial edit. It does not establish arbitrary
creature support discovery or a complete semantic limb rig.

## Visual Admission

The pressure cast is aesthetically positive. Three annotated views were
inspected:

- `heavy-seed720201/front-recentered/witness/atlas-front-three-quarter.png`
- `heavy-seed720201/front-recentered/witness/atlas-rear-three-quarter.png`
- `heavy-seed720201/front-recentered/witness/atlas-low-side.png`

Marker colors:

- cyan: `front-left`
- magenta: `front-right`
- gold: `rear-left`
- blue: `rear-right`

Small surface markers show sampled contact and rigid-core vertices. Large
colored spheres show contact centroids. Wire ellipsoids show influence bounds.
All four bounds land on distinct support feet/lower appendages. The deep belly
does not enter a rigid core. Large upper posterior masses remain body-carried;
the atlas represents the contact effector and local lower-appendage carrier,
not the full thigh.

## Route Receipt

The pressure GLB came from GPU Greenroom job `9c153ba6b424` using effective job
type `trellis2mlx_fast`: seed `42`, resolution `512`, `6` steps, no cascade,
`200000` target faces, `1024` texture, simplify-first. Wall time was `79.5s`.
The Greenroom receipt did not emit attention-backend identity, so this assay
does not make an SDPA-backend claim.

Key SHA-256 identities:

- pressure GLB: `bf85508eb353f742611369c839dfb67d23aa19ef7bdffbd63f015c6274f04c68`
- admitted pressure atlas: `371f061d5cda49eba1acc2333da485194428722afe1a38d822e579c0001397fa`
- annotated pressure GLB: `8d53b12bdf8025940b57a914058d87a4e48ceae250e8dd9cc6f7816bda586fa7`
- assay report: `7098ca8493db7b2ea1687d6718ff01b7eaa542a1c919ef686ed5a508debc374a`

`assay-report.json` is the machine-readable verdict. The runner writes a
failure report even when route verification or cast loading fails.
