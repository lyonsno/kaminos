# Earth material workshop

Open `?workspace=workbench&experiment=earth-material` to work a small bounded
specimen of cohesive earth and explicit mineral grit. Move the translucent
spherical forming tool using ordinary scene selection and the transform gizmo,
then choose **Press at tool**. Press depth and duration are editable. **Advance
earth** lets gravity and contacts evolve the specimen without the tool.

The first preparation model uses the already installed Cannon ES 0.20.0 CPU
contact/rigid solver. Soil is represented by contacting mass-bearing spheres
joined by cohesive distance constraints. Yielded bonds retain changes to their rest lengths in compression and extension;
sufficiently stretched bonds break. The tool is lifted and a separate unforced
release interval is simulated before the press result is presented. Grit has convex faceted geometry
and full translating/rotating rigid dynamics. Gravity, friction and reciprocal
contact act on both. This is an exploratory cohesive aggregate model, not a
calibrated soil continuum or a retained Hill terrain fork. The tray has fixed
sides and a base. No periodic dynamics or seamless material is claimed.

A compact particle-density field supplies the implicit matrix. A coarse marching
tetrahedra mesh previews that field; **Prepare capture mesh** extracts it at the
capture detail setting. Changing extraction detail leaves physical state intact.
Explicit grit keeps its actual convex geometry in both reconstructions. The
initial field can look overly smooth or bead-like; this implementation is the
surface we will improve through authoring, not a claim of naturalistic earth.

**Trace frozen specimen** prepares the capture mesh and opens the same frozen
state as a single bounded specimen in the existing surface path tracer, under
the ordinary scene camera and lights. The saved training recipe separately retains
its finite repeated query neighborhood. **Return to material workshop** restores the saved authoring specimen.
This switch has one active experiment at a time. The physical forming tool is
excluded from the frozen material response. Source capture supports native
point/spot/directional lights and constant environment through the existing
integrator; it adds no new rendering model.

**Save specimen JSON** and **Load specimen JSON** round-trip the represented
particle/grit positions, velocities, orientations, yielded/broken bonds, physical
clock, settings, view and object/tool poses. Reconstruction rebuilds contact
caches, so a loaded continuation is a cold-contact continuation rather than a
bit-identical copy of the solver's internal warm state. These files are the
workshop's continuation route; this experiment does not yet add an ordinary
whole-scene Save/Load record domain. The current setup is also projected through
Workbench experiment inputs after an operation.

Agents use the same operations via `window.kaminosWorkbenchExperiments.invoke`:
`advance({seconds})`, `press()`, `configure(settings)`, `freeze()`, `snapshot()`,
`load(recipe)`, `source()` and `reset()`. `freeze()` returns `{source,authoring,
surface}`. The `source` descriptor includes the complete frozen snapshot and
includes a finite repeated neighborhood and can be placed in the existing fit
tool's caller JSON:

```js
const frozen = await window.kaminosWorkbenchExperiments.invoke('freeze');
// Persist {source: frozen.source, fit: {...}} at a caller-chosen path.
```

Then run `node tools/ground-material-fit.mjs CONFIG_JSON OUTPUT_DIR` through
Greenroom. The explicit `kind: 'earth-specimen'` route cannot silently fall back
to the older analytic ground source. Optional finite repeated halos support
neighborhood experiments but do not repair a bounded specimen's boundary.

Material-query UVs are anchored at the projected-area mean height of the matrix.
Rays start safely above all source geometry with their horizontal origin shifted
so they pass through that UV on the material plane. This separates the safe ray
launch height from the learned material coordinate plane. Older sources keep
their original launch-plane semantics unless a sampling plane is supplied.
Capture recipes add one repeated neighbor ring to reduce bounded-edge misses.
This remains a finite-neighborhood approximation with visible authored seams,
not an infinite periodic transport solution. Inspect the source before investing
in a fit, particularly at grazing directions.
