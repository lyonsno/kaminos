# MLS liquid runtime

## Authored water

Ordinary Add → Water sources now use the rebuilt MLS-MPM engine. Their finite
drops and continuous inlets share the scene device, current plane/sphere/bowl
colliders, playback, source transforms and saved setup. The old fluid solver is
not a fallback. Source speed and radius pass through in authored world units.
Finite releases persist; continuous particles retain the producer’s six-second
lifetime and report capacity saturation. Finite size/target/bounds changes apply
on Replay; continuous pose/rate edits affect subsequent births immediately.

The authored viewport uses the scene environment for reflection, raw scene
lighting/depth for refraction, and one final scene-camera transform and selection
overlay. Full, Proxy and Hidden preserve that camera. Flame emission and smoke
compose before/after the water surface according to their depth. This is optical
composition; it does not add a thermal response to water contact.

The grid spans the authored bounds at the initial population’s derived cell
width. Smaller drops at a fixed particle target require finer grids. The solver
uses two-dimensional grid dispatch, respects the device’s actual buffer limits,
and rejects unsupported allocations without silently changing target or bounds.

## Producer experiment context

The following describes the separate hand experiment, not the authored host.

This is a provisional alternative to the incumbent fluid, not its replacement.
Use the existing Workbench experiment `hand-browser-juice` with inputs
`{"fluidBackend":"mls-mpm","particleCount":12000,"sourceFlux":1800}`.
The browser-hand asset/recording server is still required. Omit `fluidBackend`
to use the incumbent. The hand model, mesh placement, distal-axis extension
rule, packet and raw/rendered recording are unchanged.

`mls-juice` exercises the same host with an explicitly synthetic moving nozzle.
Its Run/Sweep controls and emission-rate field use the same operations an agent
can invoke. It is not a live hand or a substitute for hand-response judgment.

`hand-jet-runway` is a separate live-hand setup with a rectangular
192 x 80 x 256 grid at the same 0.05 cell width, a 4.5 world-units/second
launch speed, 12,000 capacity and 1,800 requested births/second. It expands
the actual receiver, not only its rendered floor. The receiver is still the
prescribed flat domain and sphere, not Hill of Hills terrain or terrain contact.
The stronger launch keeps the source pose, fingertip direction and extension
rule unchanged. Jet speed and future-particle lifetime use the live numeric
controls without resetting the camera or existing water.

`fluidGridSize` accepts either a cubic side length or three axis lengths in
the hand experiment; the synthetic nozzle accepts `gridSize`, `jetSpeed`, and
an `emitter` object with `origin` and `direction`. Runtime `solver.domain`
reports effective grid dimensions, cell size, origin and collision bounds.
Larger grids increase real work. No capacity, timing or visual-quality claim
follows from the preset or from a vacuum ballistic sizing calculation.

## Simulation

The APIC transfers, quadratic 27-node stencil and weakly compressible pressure
stress come from the pinned MIT-licensed Splash kernels in
`vendor/splash-mls-mpm`. Only active particle slots participate. Each birth is
copied into its exact position in the GPU command stream before that substep;
slots are reused after their packet lifetime, not silently overwritten early.
Admission, saturation and outside-domain rejections are exposed. Admission is
a CPU release plan, not a GPU particle-count measurement; `snapshot` explicitly
reads complete native state outside the serving path.

The default grid is 64 cubed, cell width 0.05 world units, with a 1/240-second
physical substep. Upstream model gravity 0.4 is scaled to world gravity 9.81.
Packet strength is interpreted as world units per second, converted to model
velocity; radius and aim remain world-space packet values. Material defaults
remain upstream stiffness 50, rest density 3, viscosity 0.1 in model units.
No surface-tension force, arbitrary scene collision, two-way body response or
flame-volume transport is implemented. Different per-finger chemistry is not
yet simulated. Numerical collision covers the rectangular domain and one
prescribed sphere; presentation shows a collection tray and that same sphere.

Elapsed time is accumulated without dropping catch-up steps. A busy GPU holds
the next simulation batch rather than building an unlimited queue; pending
elapsed time is retained until dispatch. Clock readouts count submitted steps,
not completed GPU work. Pausing holds simulation time. A native snapshot waits
behind submitted simulation work and is suitable for completed-state checks.

## Presentation

The renderer borrows the real host device/camera and scene color/depth. Particle
spheres produce front depth and additive thickness at 0.7 render scale, followed
by two depth-aware bilateral passes and a scene-refraction composite. Reflection
is a simple analytic sky, not the host environment. These optics are deliberately
smaller than the incumbent renderer; they do not imply equivalent lighting or
transport. The host applies its existing display transform afterward.

First evidence must include moving emission, impact/collection, native finite
state, effective route and dense rendered motion. A picture of a pool or a kernel
timer alone does not establish responsive Finger Juice. No comparative cost or
operator-acceptance claim follows from the standalone nozzle fixture.
