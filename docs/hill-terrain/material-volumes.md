# Rock and soil material specimen

Open `?workspace=workbench&experiment=hill-volume` in the shared Workbench. The specimen starts paused. It contains the existing authored nine-solid outcrop and directly constructed soil volumes forming a ridge, bank and hollow. The earlier heightfield formation remains a separate landscape reference.

**Play** evolves the material; **Advance 0.1 s** pauses and advances exact physical substeps. **Push material** applies a localized velocity impulse at the editable specimen-local center and radius. Choose a rock to release its represented attachment or weather its surface. **Prescribed growth** moves the lower boundary and anchored rock with a smooth spatial drive; it is an explicit input, not a tectonic or ecological model. Native scene transforms position the whole specimen. Reset reconstructs its initial material state. Camera movement does not resample the material.

The operations behind these controls are available on `window.kaminosHillVolume` and through `window.kaminosWorkbenchExperiments.invoke`. `recipe()` retains initial configuration, editable settings and view. It does not retain an evolved simulation. `snapshot()` is an explicit diagnostic acquisition of complete material and rigid state; it is outside the playback path. `gpu()` exposes same-device state and geometry buffers, their generation, and the specimen-to-world transform for later consumers. No hand or fluid consumer is integrated by this experiment.

## Material construction and evolution

Persistent soil samples carry position, mass, reference volume, velocity, an APIC affine velocity gradient, pressure, deviatoric stress and accumulated compressive strain. A temporary three-dimensional grid gathers mass and momentum, applies stress and contact, and transfers velocity back to the samples. Quadratic 27-node APIC transfer follows the existing pinned Splash MLS machinery; the material and contact laws differ from the fluid solver.

The soil law is rate-form hypoelastic with a Jaumann stress update and a pressure-dependent deviatoric yield projection. Compression increases pressure; tension is released. The Frobenius norm of deviatoric stress is limited to the configured coefficient times pressure. This is a provisional granular continuum law, not a calibrated material or a finite-strain fracture model. Initial parameters are in SI units. The explicit timestep is checked against the elastic wave-speed condition.

Each rock retains a closed convex plane-defined boundary. Its volume, centroid and full inertia tensor come from exact closed-surface tetrahedron integrals. That integration is a preparation calculation; these tetrahedra are not a connected deformation mesh. Runtime rock state is a rigid pose and velocity. Soil contact contributes equal and opposite linear/angular impulses. Finite source triangles supply outside-corner distance; planes supply interior distance. Released fixture pieces use vertex/face contact against anchored rock and the lower support. General free/free piles and edge/edge contacts remain outside the demonstrated contact class.

Weathering is a bounded surface-recession operation: move the source planes inward, reconstruct the closed boundary, subtract its lost mass and add that mass as loose samples from the removed shell. It can therefore change near-vertical faces without a horizontal height sampling requirement. It is prescribed recession, not a moisture-driven weathering-rate model. Geometry reconstruction requires an explicit state acquisition; ordinary motion retains resident GPU state. Weathering must preserve the physical clock and current growth boundary.

## Surface and limits

Rendering extracts a soil isosurface from the current GPU mass occupancy using six tetrahedra per grid cell. A GPU indirect draw uses the generated vertex count. The allocated maximum follows the mathematical maximum of twelve triangles per cell; it is not a contributor-retention cap. Rock rendering uses the same retained source geometry and current rigid pose as contact. Both update on the existing scene device without playback readback.

The initial surface is visibly faceted at the specimen's chosen grid spacing. It demonstrates material support and evolution, not naturalistic closeup detail or the macrostructure quality of the earlier formation system. General new cracks through intact rock, erosion by the live fluid solver, ecological succession, history-driven world processes and a permanent heightfield/volume coupling remain subsequent work. Prescribed growth exercises the mechanical response to a changing world boundary; it does not supply those causes.

Run the focused Node checks with:

```sh
npm test -- --only tests/hill-soil-material.mjs,tests/hill-volume-model.mjs,tests/hill-volume-witness.mjs
```

`tools/hill-volume-witness.mjs` accepts explicit `--root`, `--out`, `--url`, `--browser`, `--playwright` and `--phase initial|numerical`. The numerical route runs the production WGSL material law, settling, a push, joint release, growth, weathering and close/reopen. It retains raw state, captures, source hashes and failure phase. It requires an independent browser executable and isolated profile. Simulation runs and performance measurements use the shared GPU queue; ordinary initial saved-state inspection keeps its lightweight route.
