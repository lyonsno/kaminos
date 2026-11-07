# Retained Volume Presentation Frame

The volume runtime exposes `setPresentationTransform({translate:[x,y,z],scale:s})`
and `presentationFrame()`. Translation is finite and scale is finite, uniform
and positive. The frame is transient presentation state, not an authored domain
edit or a saved fluid checkpoint. Identity is the default.

For a physical domain transform `F` and presentation parent `P`, displayed
coordinates use `P(F(x))`. Camera/depth conversion, shared optical source
metadata, lighting bounds, mesh collision mapping and thermal material coupling
use that composed frame. Simulation calibration, cell dimensions, fields,
velocity, time step, fine/outer world mappings and source settings stay in the
physical frame. Existing local optical coefficients are not multiplied by the
presentation scale.

```js
const previousPause = volume.debugState().simulationPaused;
volume.setPresentationTransform({translate: [3, -2, 7], scale: 0.0494});
const frame = volume.presentationFrame();
// frame.physicalTransform, frame.presentationTransform, frame.worldTransform
```

This operation neither pauses nor resumes simulation, schedules a domain remap,
replaces fields, allocates a new volume, nor reads GPU data back to the CPU.
The caller owns matching scene-object presentation. Scene collision and thermal
meshes are supplied in displayed world coordinates; their composed mapping back
into local cells follows the frame. Source controls and retained fine/outer
simulation coordinates remain physical coordinates.

Withdrawal uses the existing activity owner, not domain relocation or disposal.
The low-level runtime's `await volume.setActive(false)` drains an admitted frame
and retains allocations; `setActive(true)` resumes that retained runtime. It
does not change `simulationPaused`. A consumer integrated with the native flame
feature must use that feature's activity owner so subsequent visibility updates
do not disagree with the runtime. On re-entry, update the presentation transform
before resuming. Hide/show the accompanying scene objects at the same boundary.
Inactive raw scene-volume, point-medium and irradiance-atlas fields are explicitly
unavailable to lighting while retaining their allocations. The atlas receiver
refreshes its world bounds without needing a new allocation generation. Source
metadata includes `physicalTransform` for guided/regional authoring proposals;
`worldTransform` remains the composed frame for optical receivers and geometry.

Rotation and nonuniform scale are not represented by this API. Moving a fine
box through stationary world gas is still `relocateOrdinaryDomain`, with its
existing overlap-remap semantics; it is not an alternative way to carry a
workshop's entire retained material frame. This API does not prepare thermal
meshes, author cold-smoke deposits or establish an occupied-fluid cost budget.
