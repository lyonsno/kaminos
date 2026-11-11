# Earth material workshop

Open `?workspace=workbench&experiment=earth-material`. The left experiment panel
is hidden. **Earth** opens material/surface/file controls at the specimen;
**Tool** selects the forming sphere through the shared editor. Move that sphere
through the earth with the ordinary scene gizmo. Physics follows the movement
and the sphere stays where you put it. **Live / Paused** beside the tool pauses
physical input so the sphere can be repositioned freely. No new domain hotkeys.

A persistent worker owns the same physical specimen during live and explicit
advance. Each observed hand sample retains its duration and endpoints; solver
substeps sweep the tool between them with contact velocity. Pending input is
processed in order rather than discarded. Hidden-tab elapsed time is excluded on resume. The physics clock can lag the hand
under load; this implementation does not promise real-time default-specimen
throughput or a separate high-fidelity offline physics model. Pausing drains
already accepted input. A short configurable contact/settling tail follows
movement, then the physical clock rests until another intervention.

A separate worker reconstructs a **coarse live surface at detail16 by default** (or the
chosen preview detail when lower). While input continues, completed coarse
surfaces can follow the evolving physics without waiting for detailed meshing.
The live meshing worker stays resident across updates. After motion and its
settling tail stop, the chosen resting detail rebuilds automatically, without an
additional quiet-delay timer. Live, resting and capture detail are separate
guarded settings under Earth → Surface. New motion cancels obsolete fine reconstruction; generation and
physical-revision checks prevent old output replacing a newer specimen. Preview
and capture detail change geometry sampling, not the retained physical state.
The view and tool remain interactive while these jobs run. This is a first
interaction implementation; the physical model remains exploratory.

Detail and timing values are typed and committed with Enter, rather than dragged
or applied on each keystroke. A rejected request restores the accepted value and
shows its error in the viewport. Interactive timing controls support 0.01–1 second
per operation; the underlying physical preparation API still accepts longer work.
This is an interactive control allowance, not a measured solver capacity ceiling.

Surface rebuilding runs in a disposable worker. Interactive reconstruction admits
at most 2,097,152 grid cells per request; this is a provisional work allowance for
the authoring interface, not a measured hardware-capacity ceiling. The grid's
actual storage is checked against exposed heap availability, and actual emitted
triangles are checked during extraction against the device buffer limit and a
conservative transient-storage estimate. Interior cells are not charged as
surface triangles. There is no fixed resolution45 ceiling and no silent detail
reduction. The underlying source builder accepts caller-owned allowances for
offline work.

**Stop** cancels reconstruction and queued physical execution, retaining the last
completed surface. The in-flight physical sample may complete; canceled samples
remain marked stopped in the observed hand history. Resume or an explicit
subsequent operation can reconstruct that accepted physical state. Physical state may have advanced beyond
that last surface after stopping; the next successful action rebuilds it.
Object chips remain reachable at the viewport edge when their world anchors move
offscreen and identify that offscreen condition. Hidden objects keep hidden chips.

The first preparation model uses the already installed Cannon ES 0.20.0 CPU
contact/rigid solver. Soil is represented by contacting mass-bearing spheres
joined by cohesive distance constraints. Yielded bonds retain changes to their rest lengths in compression and extension;
sufficiently stretched bonds break. The scripted `press()` agent operation remains as a controlled fixture; ordinary
authoring uses native movement and does not return the sphere to a scripted pose. Grit has convex faceted geometry
and full translating/rotating rigid dynamics. Gravity, friction and reciprocal
contact act on both. This is an exploratory cohesive aggregate model, not a
calibrated soil continuum or a retained Hill terrain fork. The tray has fixed
sides and a base. No periodic dynamics or seamless material is claimed.

A compact particle-density field supplies the implicit matrix. A coarse marching
tetrahedra mesh previews that field; rendering or exporting a teacher extracts it at the
capture detail setting. Changing extraction detail leaves physical state intact.
Explicit grit keeps its actual convex geometry in both reconstructions. The
initial field can look overly smooth or bead-like; this implementation is the
surface we will improve through authoring, not a claim of naturalistic earth.

**Render frozen surface** prepares the capture mesh and opens the same frozen
state as a single bounded specimen in the existing surface path tracer, under
the ordinary scene camera and lights. The saved training recipe separately retains
its finite repeated query neighborhood. **Back to earth** restores the saved authoring specimen.
This switch has one active experiment at a time. It preserves the authoring
camera and reuses the already prepared frozen surface; a cache miss reconstructs
in a worker. Derived geometry is not serialized into the authoring address. The physical forming tool is
excluded from the frozen material response. Source capture supports native
point/spot/directional lights and constant environment through the existing
integrator; it adds no new rendering model.

**Specimen files → Save** and **Load** round-trip the represented
particle/grit positions, velocities, orientations, yielded/broken bonds, physical
clock, settings, view and object/tool poses. Reconstruction rebuilds contact
caches, so a loaded continuation is a cold-contact continuation rather than a
bit-identical copy of the solver's internal warm state. These files are the
workshop's continuation route; this experiment does not yet add an ordinary
whole-scene Save/Load record domain. The current setup is also projected through
Workbench experiment inputs after an operation or completed fine reconstruction.
Save retains the observed forming samples as well as the current physical
snapshot. The samples describe hand motion; explicit material/advance changes
still use the common recorder and the complete snapshot is the continuation
authority. `snapshot()` drains captured input before returning. Worker failure
is surfaced; pending input is retained rather than silently claimed applied.

Agents use the same operations via `window.kaminosWorkbenchExperiments.invoke`:
`live(boolean)`, `advance({seconds})`, `press()`, `configure(settings)`, `freeze()`, `snapshot()`,
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

The source-height scan is iterative. Dense triangle output no longer expands
three heights per triangle into function arguments, which previously raised
`RangeError: Maximum call stack size exceeded` independently of GPU capacity.
The regression retains 60,000 explicit grit faces without this argument overflow.
The exact operator-reported resolution threshold remains to be exercised through
Greenroom; the crash is not treated as proof of a physical resolution ceiling.

The transport view also has no left-panel controls: **Back to earth**, pause, and
folded render settings live subtly in the viewport. Interactive render controls
support scale0.02–1 and1–8 bounces; the shared integrator/capture API retains its
own device-based limits. These preview allowances prevent accidental expensive
live work and are not claims about offline integration capacity.
