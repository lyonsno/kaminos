# Shared particle lighting: opposite-direction experiment

`volume-particle-light-sweep.mjs` consumes the existing 96-byte current-composition carrier buffer. It does not advance chemistry, change particles, replace the camera renderer, or enable lighting by default. This is a computational transport experiment on an explicitly named particle fixture stack.

Each carrier contributes intrinsic emission and soot extinction. Captured scattered illumination is excluded. The provisional 3D reconstruction is a normalized anisotropic Gaussian, with coefficient volume weighted by birth pitch squared times represented ray length. Radius, stretch, expansion, flow alignment, lifetime fade and optical gains are explicit inputs. This convention is not proof of unbiased density or visual equivalence to existing camera splats. The camera's non-Gaussian profile, screen-pixel floor and footprint cap are not silently treated as 3D material properties.

The direction and an orthonormal transverse basis define coordinates relative to an explicit world origin. Extents are in that basis. Rasterization writes RGB emission integrals and optical depth into a slab atlas. A Gaussian conditional depth CDF distributes support through all slabs rather than placing the entire particle in its center slice. The projected ellipse has an explicit sigma cutoff. Optional transverse cell-footprint filtering adds the second moment of a box footprint to covariance; its width is an input, independent of receiver count.

Each column is swept in both directions during the current submission. At a receiver center, half the local slab precedes the sample. A slab transfer is `outgoing = localEmission + transmission * incoming`; local emission uses the homogeneous-medium exponential integral. Every receiver retains radiance RGB and boundary transmission. An opaque-cell mask resets upstream illumination; emitters after an opaque cell still illuminate that next region. The caller supplies this mask. Real-scene geometry voxelization is not implemented here.

The atlas uses additive RGBA16F. Extremely bright/overlapping deposits can exceed its finite range; the witness rejects nonfinite fields. Dynamic range and deposition precision must be assessed before product adoption. No native HDR-equivalence or production overflow policy is claimed.

`tools/particle-light-witness.mjs` replays a complete captured native carrier population after checking effective route, current composition, revision, digest, byte length and nonblank source. It writes a terminal report on success or failure, retains source bytes and metadata, preserves every deposited/output value, and compares all interior receivers against independent repeated ray integration through that deposited medium. This reference establishes the sweep, not the fidelity of a coarse slab reconstruction to continuous Gaussian transport.

Run the small production-kernel checks with:

```sh
npm test -- --only tests/volume-particle-light-sweep.mjs,tests/particle-light-witness.mjs,tests/particle-light-resolution.mjs
```

The larger captured-population witness belongs in Greenroom. Its positional inputs are snapshot JSON, native capture report, expected source revision, and caller-owned output directory. Source capture may precede the lighting implementation revision; both identities are retained separately. No FPS or full-scene benefit follows from a two-direction correctness result. The next comparison charges oblique deposition, transport, receiver reconstruction and solid visibility across a useful angular set.

## Fixed-particle spatial-resolution comparison

`tools/particle-light-resolution.mjs` consumes an explicit source-root/commit manifest and the same complete retained population at increasing nested receiver widths. The physical box, particle optics, two directions and held state remain fixed. Native sweep centers are reconstructed at exact requested world-Z planes by advancing the homogeneous local transfer from an upstream center or boundary, without dividing by nearly opaque transmission. It supports this axis-aligned comparison explicitly; arbitrary world planes through oblique fields are not implied.

Raw native arrays, exact physical-plane arrays, source identities and terminal reports are retained. Higher-resolution XY samples are area-averaged onto coarser footprints for radiance ratios, spatial correlation, relative L1 difference and centroid displacement. These are diagnostics with no automatic convergence threshold. The receiver-footprint filter shrinks with cell width; changes therefore include the intended reduction in footprint smoothing. Plots need common physical coordinates and one shared color scale across the resolutions in each comparison.

Production half-slab integration uses a small-optical-depth series to avoid cancellation in `1-exp(-tau)`. A native bright/thin-slab regression guards the clear-medium limit independently of field resolution.

## First navigable angular integral

The `particle-lighting` Workbench experiment holds the complete captured native population in `experiments/particle-lighting/held-plume.*`. It validates the digest and the96-byte record count before preparing light. This is a camera-acquired held fixture, not a complete live material population or live simulation adoption.

`volume-particle-light-field.mjs` deposits intrinsic emission and current extinction once into a common optical grid. Its coefficients per unit world length are piecewise constant. Opposite-direction sweeps resample that same medium at midpoint positions in oriented boxes enclosing all eight world-domain corners. An antipodal, equal-area hemisphere sequence supplies equal full-sphere weights. The common receiver buffer stores angular mean radiance (the angular integral divided by4π); trilinear reconstruction of directional sweep centers is an explicit approximation. The field has no cached light from earlier times. Open-volume transport includes medium extinction; external scene geometry does not cast shadows in this experiment.

The reference camera in `volume-particle-light-view.mjs` traverses every intersected common-grid cell. Each cell emits its intrinsic source plus `sigma_t × scatteringAlbedo × angularMeanRadiance`. The albedo is between0and1 and the phase function is isotropic. Camera and light use the same medium; scattering is first order and is excluded from the light source solve. Camera display maps exposed radiance with `1-exp(-radiance)` and composites premultiplied color with Beer–Lambert alpha. This is an inspectable transport reference, not the particle camera renderer or a performance demonstration of it.

Receiver width, directional transport width, direction count and physical smoothing length are independent controls. Changing receiver width holds the smoothing length fixed. Smoothing spreads optical support and can conceal finer particle structure; the wider baseline is provisional. Preparation preserves the prior view while a new field is built, coalesces newer requests and labels pending/error state. The experiment retains requested controls through its inputs. The underlying fixture stays fixed while the operator navigates and compares intrinsic, scattered and combined views.

Focused checks: `npm test -- --only tests/volume-particle-light-sweep.mjs,tests/particle-light-field.mjs`. The native tests establish slab/angular units, homogeneous emission/extinction, repeated-build clearing, world-box coverage and the reference camera's source separation and interior/parallel-ray integration. Actual Workbench rendering and controls require the browser consumer witness.

## Live native particle lighting

The `optical-particles` Workbench experiment accepts `lighting` inputs and opens a
nonmodal lighting cockpit with **Alt-L** (Alt-G retains simulation-grid tuning).
`setLighting`, `retryLighting`, `openLighting`, and `sampleLighting` expose the
same operations to attached agents. Lighting settings persist with experiment
inputs. They are experiment settings, not an evolved-scene checkpoint.

The live path copies a complete native 96-byte carrier population asynchronously,
then transfers it to a dedicated WebGPU worker. The worker deposits current
intrinsic emission and extinction once into a common optical medium and reuses
that medium for all directional sweeps. It returns spherical-mean incident
radiance. Native particle rasterization samples that field for scattering while
retaining its own intrinsic emission and extinction. Captured scattered light is
excluded from the source solve. Camera-only/paused redraws reuse the field;
material changes request another solve. An in-flight solve never queues another
snapshot. Source and settings identities reject superseded results.

Receiver bounds contain the Fine box plus all current optical particle support;
receiver width controls pitch across the resulting X extent, and the panel shows
the effective three-dimensional grid. Directional grid width independently sets
the oriented sweep lattice. Source smoothing, support, bounds margin, direction
count, albedo, gain, and contribution mode are exposed. Gain/albedo/mode edits
reuse the computed field. Other edits rebuild worker resources as needed while
the previous image and normal playback controls remain available.

This first live route uses separate native and worker GPU devices. The panel
reports transferred source/field bytes, end-to-end update duration, and material
updates of field age; it does not present those as GPU timings or a production
performance verdict. `sampleLighting` retains the latest solved source records
and field for diagnosis. Shared-device work reuse is a subsequent optimization.
The transport currently describes the open particle volume; external solid
geometry is not included in these angular sweeps. The native integrator's present
Fine-only source contract also remains in force.
