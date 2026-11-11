# Stockroom Place Study

Open the Workbench experiment `stockroom-space`. It creates ordinary authored
scene objects, including a gray concrete proxy and a native timber dock. Existing
Stockroom coves remain source-linked meshes with native repetition and LOD. The
fixed bank and starting passage are an authored study, not automatically
discovered terrain or free space. `experiment_inputs={"tiles":false}` omits the
asset course for focused geometry checks.

The selected concrete place owns contextual shape handles and a surface tool.
Hover shows the effective direction before commitment. A gesture locks that
direction and its original recipe; displacement controls the result. Kept-empty
claims cut all positive material. The initial claim also carries a shallow
surrounding bearing, so enlarging it can create more concrete around the opening.
Surface pulls create new identified material or empty claims. Subsequent edits
can act on those claims or their resulting surfaces. Native scene history,
whole-object placement, duplication, save and reopening retain the recipe.

`window.kaminosSpaceAuthoring` exposes `add(recipe)`, `read(id)` and
`pull(id, probe, amount, role)`. The Workbench `pull` operation uses the same
domain function and native history target as the mouse. A probe contains a
local-space `point`, locked unit `axis`, and optionally an existing `claim` ID.
For new claims `role` is `occupy` or `empty`; signed displacement can reverse
the action. Existing claim handles resize one principal side and anchor the
opposite side. A rejected collapsed radius retains the last valid preview;
Escape restores the gesture start.

This is local form authoring, not concrete physics or a general architectural
constraint solver. The seed's shallow boundary band and local floor are explicit
construction choices. The surface is a coarse preview of analytic claims,
extracted with Three.js 0.171.0's MarchingCubes implementation. Its buffer holds
the complete five-triangle-per-cell capacity; there is no default 10K clipping.
The grid bounds follow material-bearing claims, rather than clipping edits to a
fixed world box. The default grid is 36 cubed; recipe resolution is explicit.

`vendor/MarchingCubes.js` is generated from the existing dependency using:

```sh
node_modules/.bin/esbuild node_modules/three/examples/jsm/objects/MarchingCubes.js --bundle --format=esm --platform=browser --alias:three=../lib/three.core.js --external:../lib/three.core.js --outfile=vendor/MarchingCubes.js
```

The adjacent license belongs to that vendored implementation. No shader or
renderer is added by this feature.
