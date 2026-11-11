# Local TRELLIS support and geometry LOD

The `trellis-support` Workbench experiment partitions an existing mesh into a
bounded local teacher region and retained exterior geometry. It keeps the
original triangle address, barycentric coordinates, interpolated normal and UV
for every clipped vertex. A closed twelve-triangle support volume encloses that
teacher, including disconnected and nonmanifold source sheets.

This is geometry preparation and inspection. The solid support is a diagnostic
surface. There is no trained neural material, automatic candidate ranking,
measured LOD crossover, all-angle footprint guarantee or depth/coverage decoder
in this slice. LOD preview switches representations using projected bounding-box
width; close views return to the original source geometry. That preview exposes
the routing operation before an appearance model exists.

## Open the experiment

Use the normal Workbench route:

```text
/?workspace=workbench&experiment=trellis-support&experiment_inputs=<URL-encoded JSON>
```

Inputs accept `sourceUrl`, `region`, `mode` and `threshold`. The default source is
`/scratch/barycentric-support/weathered-timber-beam.glb`; make that path available
in the served checkout or supply an existing mounted GLB URL. The source used
for the first inspection is the stockroom weathered timber beam:

```text
~/.local/state/kaminos/stockroom-shocktroops/2026-10-30/selected-four/weathered-timber-beam/output.glb
sha256: 7be0be2857ce5100ffa86f329e4068ba83ebb701c8582e2f982d28e68b8f8bdd
97,670 triangles, 120,301 vertices; one indexed primitive, one PBR material.
```

The first constructor accepts one indexed mesh with one material. The source is
loaded through the shared scene service and stays on the normal native object
selection and transformation path. It uses the shared renderer's WebGPU device,
camera, lights and frame service. It starts no independent adapter or renderer.
Reopening `read().shareInputs` reconstructs the source and region. Generated
partition geometry is an experiment lifetime resource, not a separately saved
scene-domain format.

Region coordinates are source-mesh local coordinates. `origin`, `normal` and
`tangent` define a chart; `radius` is the square half-width, `depth` the inward
extent, and `top` the outward extent. The CPU constructs a triangle AABB broad
phase and complementary exterior fragments. Production WGSL clips candidate
triangles against all six planes and returns local positions and source
barycentrics. A convex triangle gains at most one vertex per clipping plane,
so nine polygon vertices are sufficient by construction; no source triangles
are dropped to meet a budget. Empty intersections fail visibly.

All triangles of the chosen primitive participate, irrespective of winding.
Source geometry outside the volume remains explicit; other scene objects stay
external. Bounded geometry does not imply that incident lighting or later ray
transport is local: the future decoder/renderer needs an explicit exit contract.

Display modes:

- **Source region + support outline**: retain the original maps and tint the
  clipped source region teal, with an orange support outline.
- **Original source**: restore the complete original mesh.
- **Solid support diagnostic**: retain the exterior and replace the local
  source by the orange closed support. Its visible difference is intentional.
- **LOD routing preview**: show the source above the configured projected width
  and the diagnostic support below it. Near-plane crossings retain the source.

Numeric region edits rebuild automatically. `setRegion`, `setMode`, `load`,
`setThreshold`, `frame`, `frameRegion` and `inspectCandidate` are available through
`window.kaminosWorkbenchExperiments.invoke`. The display and agent operations
share the same implementation. Failed region proposals retain the last
successful candidate and expose the error.

## Fitted lid constructor

`extractLocalSupport` additionally attempts a single-valued square source chart
with a shared rim. It rejects holes, disconnected sheets, nonmanifold edges and
inconsistent projected coverage. `fitLocalSupport` fits a fan-shaped enclosing
roof in WebGPU. It intersects source triangles with roof sectors and solves the
height constraints at their intersection vertices, rather than testing only
source vertices or the central sample. The first examined beam regions fail the
source-chart topology gate; the closed-volume constructor handles their raw
triangle soup without repairing it.

## Verification

```sh
npm test -- --only tests/trellis-local-support.mjs
SHADER_HERDER_STRICT_METAL=1 node --test tests/trellis-local-support.mjs
```

The native tests execute production WGSL through the installed Shader Herder.
They check coincident sheets, source interpolation, square coverage and an
off-center peak that a naive maximum-height roof intersects. These small kernel
checks establish numerical behavior, not throughput.

`tools/trellis-support-witness.mjs URL OUTPUT_DIRECTORY INDEPENDENT_CHROMIUM`
uses Playwright Core (or `KAMINOS_PLAYWRIGHT_MODULE`) and an independent browser
with a private profile and mock Keychain. It changes actual controls, captures
source/partition/support views, verifies both footprint-routing branches and
records served asset identity. It writes a report on success or failure. Saved
asset inspection is a lightweight direct run; performance comparisons and
heavy extraction/training use Greenroom.
