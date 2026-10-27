# Hand Reach Experiment

`?experiment=hand-reach&workspace=workbench` mounts a registered hand, a fingertip
target and a physical cube/table in the ordinary Workbench scene. Camera acquisition,
mesh inference and rendering use the existing hand application and scene host.
Start camera loads the prepared models before requesting camera access; Stop
camera releases its tracks and clears contact/grab state. Target and cube
positions, size, handedness and assumed focal ratio remain editable.

Prepare the usual local MobRecon/detector packages following
[`models/mobrecon/README.md`](../models/mobrecon/README.md). The default package
directories are `/scratch/mobrecon/package/` and `/scratch/hand-detector/package/`.
The experiment additionally needs the upstream joint regressor:

```sh
python models/mobrecon/prepare-hand-registration.py \
  --source /path/to/HandMesh \
  --out scratch/hand-registration/registration.json
```

The exporter verifies the supported `template/j_reg.npy` hash and records its
provenance. This is a local, MANO-derived asset subject to the source terms, not
an asset bundled in this repository. A Python environment with NumPy is needed
only for preparation. `experiment_inputs` accepts `mobreconPackage`,
`detectorPackage` and `registrationUrl` to choose other served locations.

## Placement And View

Registration uses the released HandMesh depth-weighted projection objective,
solved analytically for translation with the released depth bounds and adaptive
joint rejection. Native mesh and crop landmarks remain separate from placement.
The default camera assumes focal length `max(image width, image height)` and a
centered principal point. These are camera-relative estimates, not calibrated
world coordinates. Focal ratio changes the assumption explicitly.

The operator view is a proper 3D rotation, not a horizontal image reflection:
native camera `[x,y,z]` maps to `[-x,0.2-y,z-0.6]`. The initial scene camera sees
the back of a right hand whose palm faces the physical camera, with its thumb
on screen-left. Only left-hand reconstruction reverses triangle winding.

Index-tip target proximity uses actual 3D distance and increases the target's
brightness. Contact physics is the default interaction: Cannon0.20.0 integrates
the cube's translation/rotation, gravity, table support and friction. Overlapping
sphere proxies along all five fingers and across the palm follow the measured
pose through finite-strength motors. Contact surfaces, rather than a pinch
predicate or attachment, move the cube. The raw mesh remains measured geometry;
the visible wireframe contact hand shows the solved proxies, and contacting
proxies/cube become amber. Proxy separation from the mesh is real compliance,
not an improved neural prediction. These proxies approximate hand volume; they
are not an anatomically constrained skeleton or mesh collision solver.

The physical clock uses the shared scene loop, with small travel-aware steps.
Pause physics freezes that clock; a hidden document does not accrue simulation
time. Detector misses and stale/ended camera input remove the physical hand;
the cube loses its support and continues falling/settling. Finger force,
friction and contact radius are editable. Contact records contain finger/object
identity, contact point, normal, separation and simulated force. Finger-attributed
normal impulse accumulates across solver substeps, with the proxy, object and
simulation-time span retained; separating zero-force rows do not qualify as a
causal response in the witness. No force is
measured from the camera, and stable frictional pickup remains an experimental
interaction rather than a demonstrated tracking-quality guarantee.

Pinch attachment remains a separate comparison mode. Its thumb/index midpoint
must enter a pinch inside the cube, preserving the initial offset. Opening
releases it in place; it has no gravity or physical grasp. Reacquisition requires
an open hand in this mode only. Changing modes stops camera acquisition.

Placement fit defaults to the released all-joint objective. The optional wrist
and knuckle fit uses joints0/1/5/9/13/17, omitting articulated finger joints from
translation estimation. Both fits, their all-joint reprojection errors and their
translation disagreement are recorded. This is a reversible comparison for
pose-coupled drift, not a calibrated correction or ground-truth anchor. A
synthetic inconsistent-finger case distinguishes the fits; the reported live
drift has not yet been attributed from the operator's original trial.

## Retained Input And Verification

`presentRetained(result)` accepts the hand API's native prediction, dimensions,
explicit source identity and optional triangle indices. It stops live acquisition
and labels the presentation as replay. Without triangle indices it loads the
model package for topology. It does not pretend recorded input is a live camera.

`Record trial locally` defaults on. Each inference uses a frozen camera frame;
its full-resolution PNG, native prediction, crop, effective placement and scene
state are committed together to browser-local IndexedDB. Stop finishes the
trial; Save trial stops and downloads its JSON with embedded PNGs. No camera
images are uploaded. Recording adds PNG/storage work; switch it off while the
camera is stopped when that diagnostic tradeoff is unwanted. A storage failure
stops acquisition visibly and preserves earlier committed frames. There is no
automatic pruning. `readTrial()` returns the retained trial; its ID in `read()`
can also be passed to `readHandReachTrial` after reopening the same browser origin.

Focused contracts: `npm test -- --only tests/hand-camera-registration.mjs,tests/hand-reach-state.mjs,tests/hand-reach-lifecycle.mjs,tests/hand-reach-witness.mjs`.
The optional `models/mobrecon/hand-reach-witness.mjs` exercises real inference on
a retained camera recording and writes a phase-bearing report plus desktop/mobile
screenshots. Browser, Playwright module, Python interpreter, recording, replay
and output paths are explicit command arguments; run it through the shared GPU
queue. It does not establish operator-live depth stability.

`advancePhysics(seconds)` and `presentContactFixture({source:{id},proxies})`
exercise the same contact engine with explicit synthetic input. The fixture
source stays labelled separately from recorded predictions and camera inference.
These operations support deterministic push/torque checks without pretending
that the model supplied the fixture. They do not establish live manipulation.
