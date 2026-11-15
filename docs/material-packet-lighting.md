# Current material packet lighting

The Optical Particles Workbench experiment offers **Current material packets**
next to **Fine material reference** in Packet illumination. The primary optical
particles continue to own material, reaction and display. A fresh GPU reduction
partitions their current admitted material into common packets. Each occupied
packet is a receiver; each packet with intrinsic emission is also a source.
Every emitting packet participates. Packet advection and retained light history
are subsequent work.

## Material approximation

Each material stratum fits separate emission and extinction kernels, retaining
integrated RGB emission, integrated extinction, weighted centers and full spatial
covariances. They are normalized finite ellipsoidal Gaussians. An absorbing soot
region need not share the bright region's shape. Changing shape scale or cutoff
preserves the declared integrated amount.

That amount uses a provisional volume proxy: the primary finite Gaussian profile
area times base support radii in two axes times the acquired represented ray
interval. Emission gain, extinction gain, material density and survival fade are
included; captured incoming light is excluded from intrinsic source emission.
This is an explicit coarse three-dimensional model, not a proof that the
camera-acquired optical interval specifies a unique volume. The fine material
reference and unchanged primary display provide comparisons.

The reduction reads all admitted current primary slots once for assignment and
moments. Its spatial bins are reconstructed each solve and do not claim stable
packet identity across time. There is no separately advected or reacting flame.

## Fresh connection integral

Each source–receiver packet connection samples finite orthographic sub-rays.
Distant packets use a source-facing bundle. Close or overlapping packets use the
configured spherical directions and a receiver-sized transverse patch. Current
solid triangles clip each actual ray. All intervening extinction kernels
participate; the selected source packet supplies intrinsic emission.

Finite Gaussian line integrals deposit emission and optical depth into ordered
sections. Each section resolves homogeneous emission and extinction together,
then the sections compose front to back. Transverse/angular weights produce
spherical-mean incoming radiance. The fine consumer reconstructs that incident
term and scatters it by current material once. Coarse material overlap adds
coefficients; it does not multiply copies of received illumination.

Transport submits coarse kernels rather than drawing every fine particle for
each connection. It currently scans coarse kernel bounds per sub-ray and uses a
simple current-triangle loop. Cost still grows with occupied packet connections,
transverse samples, directions, internal material detail and depth intersections.
No temporal performance saving is claimed. Exact effective device capacity is
checked before allocation/dispatch; material is not silently truncated.

## Independent tuning controls

- **Packets across volume width** controls packet capacity, preserving domain
  aspect ratio. For Fine dimensions 32×48×32, width 4 gives capacity 4×6×4 = 96;
  actual occupied and emitting counts appear after **Read actual packet supports**.
- **Material strata per packet axis** increases internal source/absorption detail
  without increasing the packet pair count.
- **Material shape scale** and **Material support cutoff** change fitted kernel
  footprints while conserving the declared amounts.
- **Receiving blend scale** changes fine-particle reconstruction support.
  **Near receiving patch scale** instead changes transverse integration coverage.
- **Transverse samples per axis**, **Depth sections**, and **Near directions**
  control three separate quadrature freedoms. Six near directions use the axes;
  other counts use a spherical Fibonacci set.
- **Incident light gain** changes only the returned incoming term.

All numeric controls use the shared number-drag widget and the same operations
available to agent calls. Section-count pipeline variants prepare asynchronously;
new pending settings replace obsolete requests. Other density and quadrature
sizes use runtime data. Scene snapshots retain both representation choices and
settings. Existing snapshots without a mode retain the fine reference.

**Packet support view** displays measured current packet bounds or the separate
emission/extinction ellipsoids. Its step is identified; an asynchronous readback
is an observation of that step. View-only changes do not retrace held material.
The preview is transient scene geometry and does not enter solid occlusion.
`inspectPackets` returns the raw coarse buffers and counters for the same
observation. Counter overflow is explicit.

## Checks

`npm test -- --only tests/material-packet-settings.mjs,tests/material-packets-gpu.mjs,tests/packet-lighting-controller.mjs,tests/packet-support-inspection.mjs --parallel 1`
executes the production GPU reduction and transfer on the installed native shader
route. The numerical cases cover retained coefficient amounts, separate shapes,
homogeneous self emission/extinction, exclusion of captured light, third-packet
absorption and a finite solid wall including shared triangle edges. Whole-frame
performance and evolving visual quality require the live consumer; these focused
checks do not establish either.
