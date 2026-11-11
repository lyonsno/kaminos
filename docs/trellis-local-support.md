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
`/api/read?root=generated-meshes&path=barycentric-support%2Fweathered-timber-beam.glb`;
it reads a byte-identical prepared copy under the shared generated-meshes mount,
with `source-receipt.json` recording its original location and hash. Supply an
existing mounted GLB URL for another source. The source used
for the first inspection is the stockroom weathered timber beam:

```text
~/.local/state/kaminos/stockroom-shocktroops/2026-10-30/selected-four/weathered-timber-beam/output.glb
sha256: 7be0be2857ce5100ffa86f329e4068ba83ebb701c8582e2f982d28e68b8f8bdd
97,670 triangles, 120,301 vertices; one indexed primitive, one PBR material.
```

The first constructor accepts one static indexed mesh with one material and
packed float32 position, normal and UV attributes. It refuses attributes it
cannot preserve (such as vertex colors, tangents and secondary UVs), deformation
and instances. The source is
loaded through the shared scene service and stays on the normal native object
selection and transformation path. It uses the shared renderer's WebGPU device,
camera, lights and frame service. It starts no independent adapter or renderer.
Reopening `read().shareInputs` reconstructs the source and region. Generated
partition geometry is an experiment lifetime resource, not a separately saved
scene-domain format.

Region coordinates are source-mesh local coordinates. `origin`, `normal` and
`tangent` define a chart; `radius` is the square half-width, `depth` the inward
extent, and `top` the outward extent. The CPU constructs only the triangle AABB
broad phase. One production WGSL operation clips candidate triangles against all
six planes and returns both interior and complementary exterior polygons, using
the same computed intersection for each side of a cut. It returns local
positions, source barycentrics and clipping-plane provenance. A convex triangle
gains at most one vertex per clipping plane,
so nine polygon vertices are sufficient by construction; no source triangles
are dropped to meet a budget. Empty intersections fail visibly.

The result also exports source/support intersection segments with source
triangle and barycentric addresses, support face IDs and that face's UVs.
These locate the source/retained interface on the support; they may branch or
include coplanar contact edges and are not promised to form one manifold rim.
The closed box remains an untrained candidate domain. Its six-face
parameterization and the useful eventual support shape remain teacher/decoder
design questions; boundary metadata does not establish learned fidelity.

All triangles of the chosen primitive participate, irrespective of winding.
Source geometry outside the volume remains explicit; other scene objects stay
external. Bounded geometry does not imply that incident lighting or later ray
transport is local: the future decoder/renderer needs an explicit exit contract.

Display modes:

- **Source region + support outline**: retain the original maps and tint the
  clipped source region teal, with an orange support outline and pink source/
  support intersection curves in x-ray display.
- **Original source**: restore the complete original mesh.
- **Solid support diagnostic**: retain the exterior and replace the local
  source by the orange closed support. Its visible difference is intentional.
- **LOD routing preview**: show the source above the configured projected width
  and the diagnostic support below it. Near-plane crossings retain the source.

Numeric region edits rebuild automatically. `setRegion`, `setMode`, `load`,
`setThreshold`, `frame`, `frameRegion`, `probe` and `inspectCandidate` are available through
`window.kaminosWorkbenchExperiments.invoke`. The display and agent operations
share the same implementation. Failed region proposals retain the last
successful candidate and expose the error.

## Bounded geometric ray teacher

**Probe region** sends a diagnostic three-by-three set of inward rays from the
outer support face. Green lines end at source hits; red lines reach the support
exit without meeting source geometry. These are x-ray annotations. The operation
is explicit and adds no ray tracing to the steady frame loop. The sample pattern
is a small diagnostic, not an all-angle coverage estimate; agents can supply an
arbitrary ray array to `probe` through the same operation.

`traceSupportRays` in `trellis-support-rays.mjs` executes production WGSL on the
shared device. It intersects the ray with the finite support first, then returns
the nearest clipped source triangle inside that interval. Material sidedness is
explicit. Results include support entry/exit distances, original triangle ID,
original barycentrics and source-local hit position. Entry and exit boundary
addresses name the face and UV on the actual twelve-triangle support mesh, with
chart-local and source-local positions. An origin already inside the support has
no entry boundary; its entry distance is zero. Exact edge/corner crossings choose
the lowest incident face ID deterministically. `sampleSourceAddress` samples
that original triangle's UV island and interpolated vertex normal. A geometric
miss reports a finite support exit rather than silently including another part
of the asset. Continuing into retained geometry remains a renderer operation.

The first knot contains an open source hole. Its central downward ray leaves
this local support; the apparent brown floor visible in the original asset is
the far underside of the double-sided hollow shell. Reproducing that source is
distinct from filling it to depict solid timber. This inspector preserves the
source and reports the miss; it does not repair the hole or classify it as
intentional transparency. Grazing rays can also leave a support without meeting
the local source, independently of such source defects.

This teacher currently labels geometry and source addresses. It does not
evaluate material opacity, normal maps, radiance, indirect transport or learned
appearance. The initial kernel directly visits every clipped triangle; it is
for small preparation/probe queries, with no hidden triangle truncation. Large
training batches and performance measurements belong in Greenroom. This slice
makes no throughput or BVH claim.

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
npm test -- --only tests/trellis-local-support.mjs,tests/trellis-support-rays.mjs,tests/trellis-support-evidence.mjs
SHADER_HERDER_STRICT_METAL=1 node --test tests/trellis-local-support.mjs tests/trellis-support-rays.mjs
```

The native tests execute production WGSL through the installed Shader Herder.
They check coincident sheets, source interpolation, square coverage and an
off-center peak that a naive maximum-height roof intersects. Ray tests check
nearest hits, sidedness, misses/exits, parallel slab directions, transformed
charts, all six carrier face UVs, interior starts, corner ties and source UV
addresses. These small kernel checks establish numerical
behavior, not throughput.

`tools/trellis-support-witness.mjs URL OUTPUT_DIRECTORY INDEPENDENT_CHROMIUM`
uses Playwright Core (or `KAMINOS_PLAYWRIGHT_MODULE`) and an independent browser
with a private profile and mock Keychain. It changes actual controls, captures
source/partition/support views, verifies both footprint-routing branches and
records served asset identity. It retains the actual partition in `candidate.json`
and ray inputs/results in `probe.json`, alongside screenshots. It writes a
report on success or failure. Saved
asset inspection is a lightweight direct run; performance comparisons and
heavy extraction/training use Greenroom.
