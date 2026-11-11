# Coupled mechanical posing

In the mechanism inspector, enable **Force-aware G**. The current constructed
barrel/rod dimensions and authored stroke are captured once. Enter native
component editing with Tab, select a moving joint, and use G. The hand target
is compliant: the cyan tether shows the separation between the requested point
and the actual joint. All body cylinders contribute to one coupled solve.
Release commits the resulting authored pose; Escape and Undo use native history.
R and S remain explicit authoring edits. **Play** remains the authored-cycle
comparison, rather than a free-running mechanical simulation.

Select a cylinder to hold its captured length, release its elastic resistance,
or drive toward the length of its mounts in Pose A/B during a pull. Cylinder
stiffness/damping and hand stiffness/damping use the shared number-drag fields.
The captured stroke is shown read-only; changing spatial bounds requires a
future selectable stop handle. Releasing a cylinder retains its end stops.
Hardware, parameters and pose persist through ordinary scene saving.

The same native transaction path is available headlessly:

```js
const id = window.kaminosMechanisms.read()[0].objectId;
const call = (name, args) => window.kaminosMechanisms.invoke(id, name, args);
await call('mechanics', {enabled: true});
await call('pull', {joint: 3, point: [0.4, 1.5], mode: 'B'});
await call('stepMechanical', {seconds: 1 / 120});
await call('releasePull', {cancel: false});
```

Points are in the mechanism's local XY frame. Native input converts the world
target to that frame. The browser advances using actual frame delta while a
mechanical grab is active; an explicit headless step uses the supplied interval.
`read().mechanics` identifies enabled/active state, actual actuator lengths and
forces, hand target/point/force/gap, stop compression, simulation time and linear
solve residual. Idle diagnostics are recomputed for the actual current recipe.

This is a reduced planar model. Each moving hinge has an effective rotational
inertia (`node.inertia`; default one unit of link mass with rod inertia about its
hinge), and cylinders are spring/damper distance elements. A cylinder spanning
several links loads every intervening coordinate. Common ancestors that rotate
both mounts rigidly have zero distance derivative. The coupled implicit velocity
system is solved matrix-free with diagonally preconditioned conjugate gradients;
the maximum number of conjugate directions is the number of moving coordinates,
and the actual residual determines the reported convergence. Cylinder ordering
does not define separate per-cylinder poses. No dense global matrix, mesh
sampling or GPU readback is involved in the numerical core.

Stroke stops have finite stiffness and critical damping in their active normal,
so compression is reported rather than called perfect nonpenetration. Fixed
hardware validation rejects strokes extending beyond barrel/rod length. No
pressure/flow state, gravity/body-mass inference, contact avoidance or collision
repair is included. Separate object-mounted cylinders are explicitly refused by
this first planar-body entrance. This consumer does not establish performance
for a hundred/thousand-piston assembly or a full many-body engine.
