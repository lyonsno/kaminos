# Connected-body posing

Enable **Dynamic posing** in a mechanism's native inspector, enter joint editing
with Tab, and carry a point with G. The grip closely tracks reachable motion;
connected parts move with body inertia, gravity and cylinder resistance. Stop or
reverse the hand while still holding to see passive parts continue and
accommodate. Release commits the authored pose and pauses this preview; it does
not run a post-release simulation. Escape/Undo restore the native transaction. Returning the hand through its
gesture-start coordinate retains momentum, chamber pressures and the complete
recording. Live previews carry explicit write context through native history;
restore writes remain separate from equal-valued previews.
Play remains the authored-cycle comparison.

**Hydraulic response** switches the coarse fluid layer on the same body model.
Select a cylinder for Metered flow, Float cylinder or Close valve, with shared
number-drag controls for conductance and bulk modulus. Select a moving body to
change its mass. Stroke dimensions stay captured and read-only; numeric controls
do not move bounds. The original spring-response API and saved model remain
compatible, while the new body model uses passive valves rather than old spring
rest targets. Stored active cylinder drives must be released before enabling
this passive posing model; it reports that boundary before history mutation.

```js
const id = window.kaminosMechanisms.read()[0].objectId;
const call = (name, args) => window.kaminosMechanisms.invoke(id, name, args);
await call('dynamics', {enabled: true, hydraulicsEnabled: true});
await call('body', {joint: 2, mass: 3});
await call('hydraulics', {index: 0, valve: 'metered', conductance: 2e-7});
await call('pull', {joint: 3, point: [1.8, 2.2], mode: 'B'});
await call('stepMechanical', {seconds: 1 / 120});
const capture = await call('exportDynamics');
await call('releasePull', {cancel: false});
```

`exportDynamics` retains the initial recipe/mode/joint and every effective
step interval and hand target, without a retention cap. The packet can be
replayed with `createBodyDynamics` and used for fluid-enabled/disabled comparison
on identical inputs. Native frames consume their elapsed time in steps no larger
than the authored `mechanics.stepSeconds` (default1/120s), without dropping
remaining elapsed time. `read().mechanics` reports actual body velocities,
kinetic energy, active joints/cylinders, chamber pressures, hydraulic forces,
stroke compression, tracking error and solve residual. Scene saving retains the
authored settings and resulting pose.

The current neighborhood is the existing planar rooted forest with body-local
cylinders. A body's `bodyDynamics` properties are mass, center (body-local XY),
and center-of-mass rotational inertia. Gravity is expressed in that same local XY
frame; rotating the assembly does not currently rotate world gravity into it. Defaults are a1kg rod of the authored
link length, center at half length and inertia mL²/12. These are explicit mass
approximations, not inferred mesh density or separate piston-body mass. Native
mass editing scales an authored inertia with mass; no numeric center-position
control is provided without a selectable center handle.

Mass multiplication and inverse application use body spatial inertia and linear
tree passes, including cross-body inertial reactions and centrifugal/gravity
terms. The inverse mass is also the preconditioner for the implicit coupled
velocity system. Hand, cylinder drag, chamber pressure and regularized stroke
stops contribute together. Stops use a continuous unilateral compressive force;
a discontinuous damping activation was rejected after the saved-door test
stalled. The nonlinear piecewise-affine response uses directional minimization,
with actual linear residual/convergence reported. No arbitrary nonlinear
iteration cap, dense global matrix, mesh sampling or GPU readback is used.

Each cylinder has two pressure states. Chamber volume/area, bulk modulus and
metering conductance determine the implicit pressure/flow response. Finite relief
conductance opens at the pressure thresholds; make-up flow holds the low-pressure
floor so absolute pressure cannot become negative. Gauge pressure is relative to
101325Pa. Default circuits independently exchange with the reservoir; shared hose
networks, pumps and active valve control are not implemented. Closed valves can
lock available motion until relief permits yielding. Disabling hydraulics leaves
body inertia and passive viscous cylinder drag in place.

Only the grabbed dynamic island is solved. A common static anchor does not wake
unrelated branches; cylinders can join moving branches. Separate object-mounted
cylinders remain explicitly unsupported here. The model does not include mesh
collision, automatic clearance repair, general spatial joints or generated
surface recovery. Connected100/1000-body cadence requires measured evidence;
small functional tests establish neither that cost nor operator feel.

## Existing spring-response model

Existing spring-model scenes and the `mechanics` API retain the earlier response.
Enabling that API captures the current constructed barrel/rod dimensions and
authored stroke once. The inspector's **Dynamic posing** button selects the new
body model. Enter native
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
