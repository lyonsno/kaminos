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
claims exclude newly authored concrete and carry surrounding bearings. A new
empty claim can start on exposed local floor or on a bound neighbor's surface,
not only on existing concrete. Its boundary frame is chosen from nearby native
construction, with a view-facing fallback when the floor has no horizontal
neighbor. Reach controls the footprint of the next claim. Surface pulls create
new identified material or empty claims. Subsequent edits
can act on those claims or their resulting surfaces. Native scene history,
whole-object placement, duplication, save and reopening retain the recipe.

Fixed construction binds scene IDs of native dock members and box-built floors
or banks. Their live transformed geometry clips the concrete; moving or resizing
them recomputes the surface, and native Undo recomputes the previous relationship.
They remain fixed references, not automatically moved stock. Kept-empty claims
govern the new concrete, not all materials in the scene. Arbitrary GLBs and terrain
are not admitted constraint classes. Missing/unsupported bindings are reported
and the unresolved concrete is withheld rather than displayed unconstrained.

Tab enters native region editing and disarms creation. Region picking respects
claim rotation. Camera motion invalidates the old hover interpretation. Dashed
region handles describe authored space away from the current material surface;
they remain adjustable, including the depth of through-openings.

`window.kaminosSpaceAuthoring` exposes `add(recipe)`, `read(id)` and
`pull(id, probe, amount, role)`, `neighbors(id, ids)` and `sample(id, points)`.
The Workbench `pull` operation uses the same
domain function and native history target as the mouse. A probe contains a
local-space `point`, locked unit `axis`, and optionally an existing `claim` ID.
For new claims `role` is `occupy` or `empty`; signed displacement can reverse
the action. Existing claim handles resize one principal side and anchor the
opposite side. New probes may supply `radius` and a `bandNormal`. A rejected collapsed radius retains the last valid preview;
Escape restores the gesture start.

This is local form authoring, not concrete physics or a general architectural
constraint solver. Shallow boundary bands and the local floor are explicit
construction choices, available to new claims as well as the seed. The surface is a coarse preview of analytic claims,
extracted with Three.js 0.171.0's MarchingCubes implementation. Its buffer holds
the complete five-triangle-per-cell capacity; there is no default 10K clipping.
That capacity stays private to the extractor. The native mesh contains only
current drawn vertices, so framing, selection, export and repetition cannot read
stale or unwritten extractor tails.
The grid bounds follow material-bearing claims, rather than clipping edits to a
fixed world box. The default grid is 36 cubed; recipe resolution is explicit.

`vendor/MarchingCubes.js` is generated from the existing dependency using:

```sh
node_modules/.bin/esbuild node_modules/three/examples/jsm/objects/MarchingCubes.js --bundle --format=esm --platform=browser --alias:three=../lib/three.core.js --external:../lib/three.core.js --outfile=vendor/MarchingCubes.js
```

The adjacent license belongs to that vendored implementation. No shader or
renderer is added by this feature.
