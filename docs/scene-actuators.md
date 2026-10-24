# Piston assemblies

**Add → Assemblies → Piston arm** inserts an editable mechanical construction. Place it with the ordinary transform controls, then select it to crank or drive the piston in Properties. Its base, boom, barrel and rod remain separate nested groups in the outliner. Viewport picking selects the whole assembly. Duplicate copies the mechanism as well as its parts, with independent control identities.

**Assets → Assemblies** offers the built-in arm, **Save selected assembly**, and **Add saved assembly**. Saved assembly files retain their procedural parts, grouping, mechanism and source provenance. Reusing a file assigns new identities and places its authored origin at the insertion point. This first reusable-file format supports procedural mesh constructions; it rejects unsupported parts or attachments outside the selected group. Spacebar search finds **Piston arm** and **Browse assemblies**.

For custom mechanisms, open Workbench's **Piston workshop** experiment. It operates on ordinary scene
objects; it does not create a private renderer or a second scene format. Choose
a fixed base, hinged boom, barrel and rod. A rigid part may be one mesh or an
ordinary group (for example, the generated rod plus a constructed inner shaft).
Place the two mounting eyes and the boom's hinge by clicking mesh surfaces or
entering world coordinates. Choose the hinge axis and install.

Select a mechanism part to reveal **Piston** in Properties. The hand-crank slider
changes length through a single ordinary history gesture. Numeric length,
short/long cycle endpoints, period and outward fraction use the same controller.
Run repeats a smooth outward/return stroke; Stop accepts the visible length as
an authored history edit. A larger outward fraction gives a slower outward
stroke and quicker return. Stop before Save. Save/reopen restores the accepted
mechanism, paused, rather than only the displayed mesh poses.

This first solver constructs the pose of one independent grounded, hinged
mechanism analytically. It is kinematic, not force-driven. Ground frames need
positive uniform scale; drives cannot share output objects or form chains.
An unreachable length or a zero-leverage/toggle installation is refused before
mutation. Deleting a complete construction removes its recipe in the same undoable edit. Removing one attachment retains an explicitly unavailable recipe until
the part is restored or the actuator detached. Generated surfaces and hidden
shaft geometry still require preparation; installing a recipe does not repair
the mesh or discover joints automatically.

## Shared API

`window.kaminosActuators` provides `install`, `configure`, `scrub`, `finishScrub`,
`cancelScrub`, `play`, `pause`, `detach`, `read`, and `state`. The inspector and
experiment use those operations. `install` captures the actual current part
poses. Group keys are `@group:<id>`.

```js
const piston = window.kaminosActuators.install({
  label: 'Lift piston', fixedId, followerId, barrelId, rodId,
  baseMount: [0, 0, 0], movingMount: [1, 1, 0],
  hinge: [0, 1, 0], axis: [0, 0, 1],
  carried: [], // Optional rigid followers of the boom, e.g. head and source.
  drive: {min: 1, max: 1.8, period: 2, outward: 0.75},
});
window.kaminosActuators.configure(piston.id, {length: 1.4});
window.kaminosActuators.play(piston.id);
window.kaminosActuators.pause();
```

Mount coordinates and hinge direction are in the installation's world frame.
The saved reference frame anchors them to the base; a transformed base is
consumed when the mechanism is next posed. `carried` objects follow the boom;
the rod group follows its moving mounting eye. Barrel and rod undergo rigid
transforms, not nonuniform stretching. Choose nonoverlapping roles and complete
or cancel ordinary edits before another operation. While driving, beginning an
ordinary edit stops the motor; further reassembly/pose editing should detach and
reinstall the recipe so its reference attachments match the revised parts.

Scene version 13 stores `actuators` alongside objects/groups. Each recipe retains
IDs, mount points, hinge, reference poses, accepted length and drive parameters.
Older scene documents have no implicit actuator. Missing recipe references are
visible unavailable state, not silently rebound IDs or a fallback animation.

The flame-arm consumer uses the existing generated mesh, additional cuts from
Mahler's polygon tools, and an ordinary cylindrical inner shaft. Its provenance
and exact preparation receipts live with the Hostile consumer account, not as
a universal geometric fixture in the actuator module.
