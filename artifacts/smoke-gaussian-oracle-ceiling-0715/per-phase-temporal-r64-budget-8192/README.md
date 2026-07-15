# 8192-Splat Per-Phase Temporal Probe

Status: world-space per-phase representation passes; the available r64 visual
route is compositor/camera blocked and cannot adjudicate articulated temporal
continuation.

## Question

After the held `160^3` assay found a static quality knee near 8192 active
splats, can exact 8192-count products carry the authoritative short sequence at
steps `82/92/93/94`, and can the existing temporal witness show that structure?

This probe deliberately uses independent per-phase recursive fits. It does not
claim recurrence, stable row correspondence, or topology handling.

## Fail-First Fitter Repair

The first step-82 fit failed before a product with:

```text
Error: cannot split dense smoke leaf containing 20 distinct voxels
```

This was a fitter defect, not a smoke result. The baseline recursive splitter
required cumulative mass to cross half before the last coordinate; a valid
terminal-heavy leaf could therefore have no admitted cut. The new fail-first
contract calls the shared split selector with counts/masses `[1,19]` and first
failed because `chooseLegalWeightedSplitCut` did not exist. The implementation
now selects the legal cut with minimum half-mass imbalance for both baseline
and gradient allocation. The focused fitter contract passes, and all four
8192-count products complete without cap or substitution.

## World-Space Results

| Step | 8192 SSE | 128 warm SSE | SSE reduction | 8192 leakage | 128 leakage | 8192 fit/build CPU |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 82 | 0.012893 | 2.031231 | 99.37% | 0.006836 | 0.046875 | 264.07 ms |
| 92 | 0.018122 | 1.986031 | 99.09% | 0.006714 | 0.054688 | 277.99 ms |
| 93 | 0.018597 | 1.934509 | 99.04% | 0.006592 | 0.054688 | 280.47 ms |
| 94 | 0.018904 | 1.884836 | 99.00% | 0.006592 | 0.054688 | 339.64 ms |

These are exact per-phase dense-field products under
`../per-phase-fit-r64-budget-8192/`. They strongly support per-phase Gaussian
representation capacity at this grid and count. They do not establish temporal
feature identity.

## Orthographic Compositor Attack

The only camera path in the r64 temporal artifacts is the old orthographic CPU
proxy. Every source manifest has only these top-level authorities:
`backend`, `completeFieldCoverage`, `deterministicReplay`, `effectiveRoute`,
`fluidChannelOrder`, `grid`, `identity`, `prototypeIdentity`, `sampleAuthority`,
`schema`, `sidecars`, `status`, and `worldSpace`. Exact searches find no camera,
view, or projection matrices. The admitted fit reports therefore carry
`cameraIdentity: null` and `camera: null`.

At fixed extinction scale `0.0002`, step 92 produced:

| Coverage | MSE | IoU | Mean contributors/support pixel | Max contributors | CPU proxy render |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1.00 | 0.0037584 | 0.59672 | 30.92 | 97 | 11818.22 ms |
| 1.25 | 0.0032870 | 0.62031 | 45.60 | 140 | 9622.03 ms |
| 1.75 | 0.0031669 | 0.62894 | 80.11 | 263 | 5491.85 ms |

A single five-value `0.75/1/1.25/1.5/1.75` sweep eventually completed and
selected `1.75`, charging `81629.01 ms` CPU proxy render time. The harness did
write its durable report after initially returning no console receipt.

Visual inspection is decisive about mechanism. At `1.0`, the 8192 product is a
regular bright kernel lattice. At `1.25`, overlap softens the lattice without
recovering the teacher's shoulders, bends, side cavities, or density channels.
At `1.75`, the lattice collapses into nearly the same smooth carrier seen at
128. All four per-phase `1.75` sheets are coherent across time but preserve only
the carrier; they do not preserve articulated feature truth.

The orthographic result cannot overrule the native-camera r160 frontier. The
same world-space formulation improves visibly and monotonically under the
recorded perspective camera, while this camera-less projection converts a
99% volumetric SSE reduction into either lattice or blur. The limiting route in
this probe is the orthographic compositor/projection, not demonstrated Gaussian
capacity.

## Inspected Evidence

- `../per-phase-render-r64-budget-8192/sim-step-{82,92,93,94}/orthographic-render-contact-sheet.png`
- `../per-phase-render-r64-budget-8192-coverage-1/sim-step-92/orthographic-render-contact-sheet.png`
- `../per-phase-render-r64-budget-8192-coverage-1.25/sim-step-92/orthographic-render-contact-sheet.png`
- `../per-phase-render-r64-budget-8192-coverage-sweep/sim-step-92/orthographic-render-contact-sheet.png`

Every image above was opened at original resolution. The teacher, Gaussian,
and absolute-difference columns are nonblank and unobscured.

## Verdict And Blocker

- **Representation:** independent per-phase decoding remains viable and is
  dramatically better in world space at 8192.
- **Compositor:** the r64 orthographic proxy is directly disqualified as an
  articulated-structure judge at high count; it trades exposed lattice against
  blur as coverage changes.
- **Temporal:** articulated temporal continuation remains unclassified because
  independent per-phase fits do not provide correspondence, and the only visual
  route destroys the feature signal.
- **Exact blocker:** an authority-selected temporal teacher window that includes
  checksum-bound camera matrices and matched native raymarch outputs, preferably
  at the r160 mature-smoke regime. Simulator/teacher-sequence selection belongs
  to Handy. This oracle lane will not invent that authority or repurpose the single
  held r160 frame into a fake sequence.

The last trustworthy evidence is the four exact 8192 world-space products plus
the negative orthographic coverage witnesses. Once the camera-bearing teacher
window exists, this lane can immediately run the 8192 native/hostile temporal
assay and implement correspondence/topology accounting against it.
