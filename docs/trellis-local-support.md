# Local TRELLIS support, source labels and geometry LOD

The `trellis-support` Workbench experiment isolates bounded regions of an
existing mesh while preserving the original source triangle, barycentric
coordinates, UV and base vertex normal. One WebGPU operation computes both the
inside fragments and complementary retained geometry using shared intersections.
A twelve-triangle closed support encloses the selected source.

This is source/teacher preparation. There is no trained neural material,
automatic region search or measured geometry/appearance crossover yet. The
orange solid support is a diagnostic. Its LOD preview returns to the original
source geometry above the selected projected width.

## Work with a source region

Open `/?workspace=workbench&experiment=trellis-support`. The default source is an
existing Metal-finished machined graphite/metal plate:

- Source: `~/.local/state/kaminos/stockroom-shocktroops/2026-11-08/selected-five/plate-machined-graphite/finish-original-metal/output/output.glb`.
- SHA256: `fb92b5218ec297d51020f6008c5b69779c544589aa56b2e22ecf399f7ad7c45d`.
- 187,308 triangles, 147,095 vertices, one indexed opaque, single-sided PBR
  material, base-color and metallic/roughness PNG maps at 1024×1024, no normal map.
- Byte-identical shared mount: `/api/read?root=generated-meshes&path=barycentric-support%2Fmachined-graphite-finished.glb`.

The selected source has no open boundary edges after exact coincident-position
welding. It has nonmanifold joins; this is not a claim of a globally manifold
solid. The earlier timber mesh has an unintended open knot hole and is retained
as historical diagnostic evidence rather than the default source.

**Plate examples** offers a shallow milled panel as a material control and a
rolled rim as a curved geometry candidate. Both are manually selected examples,
not results of an automatic classifier. Region edits remain adjustable.
**Frame region** looks toward the selected region from its local frame, including
regions whose normal is not world-up. The loaded asset keeps native selection
and transformation ownership.

Display modes:

- **Source region + support outline**: teal source patch, orange enclosure and
  pink source/support boundary curves in x-ray display.
- **Isolated source region**: only the clipped source, with its original
  material. Surrounding geometry is hidden for inspection.
- **Original source**: complete original mesh.
- **Solid support diagnostic**: retained exterior plus the untrained orange
  support replacing the source patch.
- **LOD routing preview**: source above the configured projected box width,
  diagnostic support below it. Near-plane crossings retain the source.

The experiment temporarily disables this page's normal automatic beauty LOD
while it owns the inspection, restoring the previous enabled state on close or
initial-load failure. Otherwise a separately simplified full-object proxy can
hide the very source partition being inspected. The effective and preceding
settings are exposed in `read().sourceRoute`. This is an inspection setting;
it is not a production LOD policy or performance claim.

`experiment_inputs` accepts URL-encoded JSON containing `sourceUrl`, `region`,
`mode` and `threshold`. `read().shareInputs` retains the reconstruction inputs.
Region `origin`, `normal` and `tangent` use source-mesh local coordinates;
`radius` is square half-width, `depth` inward extent, and `top` outward extent.
Other mounted GLB URLs can be loaded through the Source GLB control. Plate
examples are unavailable for another source.

Agent operations through `window.kaminosWorkbenchExperiments.invoke` are
`setRegion`, `selectExample`, `setMode`, `load`, `setThreshold`, `frame`,
`frameRegion`, `probe` and `inspectCandidate`. Failed proposals retain the last
successful candidate. Partition geometry is owned by the experiment lifetime;
it is not a separately serialized scene domain.

## Bounded ray and material queries

**Probe region** sends nine inward rays from the outer support face. Green lines
end at source hits; red lines reach a finite support exit. Agents may supply
another ray array through `probe`. This explicit operation adds no tracing or
material-query dispatch to steady frames.

`traceSupportRays` executes production WGSL on the shared renderer device. It
finds support entry/exit and the nearest clipped source triangle within that
interval, respecting the selected material's sidedness. A hit carries original
triangle/barycentrics and source-local position. `sampleSourceAddress` resolves
that original triangle's UV island and interpolated base vertex normal.

Entry and exit boundary addresses name the actual support mesh face and UV,
with chart-local and source-local positions. An interior origin has entry
zero and `entryBoundary:null`. Edge/corner crossing ties choose the lowest
incident face ID. Source/support intersection segments carry the same support
chart addresses and original source provenance; they may branch and do not
promise one manifold rim.

`trellis-source-material.mjs` evaluates the hit UVs in WebGPU using Three's
actual uploaded source textures, including their effective sRGB format and
upload orientation. It uses each channel's UV transform, wrap/filter settings
and PBR factors. Base color is linear; roughness uses G and metalness B. Opaque
material opacity is one even if stored texture alpha is lower. Returned raw
texture/factor alpha is diagnostic only. Missing maps use white channel inputs.

These are explicit LOD0 point labels, not a footprint or lighting integral.
There is no irradiance, radiance, visibility-lighting integration or learned
response in this module. GPU textures remain caller-owned; temporary buffers
and fallback textures are released by their owner. The adapter refuses material
channels it cannot represent: normal/bump/displacement/AO/light/emissive maps,
vertex colors, physical-material extensions, non-opaque alpha and non-UV0 or
unsupported texture sampling. The first geometry adapter also refuses
multi-material, non-indexed, interleaved, non-float32, deforming, instanced or
additional-attribute meshes.

A bounded miss remains a miss; the query does not absorb external source or
scene geometry. Genuine exits at the rolled rim differ from the rejected
beam's unintended source hole. How a future decoder and renderer continue those
rays is a separate composition step.

## Geometric constructors and limits

CPU work is a triangle-AABB broad phase. The GPU clips all candidates against
six planes without a triangle cap. A convex triangle gains at most one vertex
per plane, giving a geometric nine-vertex bound. Every source winding/sheet in
the admitted primitive participates. Other scene objects remain external.

The older `extractLocalSupport` square-chart constructor additionally requires
a single-valued manifold sheet with a shared rim; it rejects holes and folded
or disconnected coverage. `fitLocalSupport` fits a fan-shaped lid by intersecting
triangles with roof sectors. It remains a separate constructor; the volume
path does not require a watertight teacher. No all-angle footprint guarantee,
BVH throughput claim or useful neural carrier fit is established.

## Verification

```sh
SHADER_HERDER_STRICT_METAL=1 npm test -- --only tests/trellis-local-support.mjs,tests/trellis-support-rays.mjs,tests/trellis-source-material.mjs,tests/trellis-support-evidence.mjs
```

Native checks execute production WGSL for clipping, support fitting, ray
intersections and texture sampling. The material oracle includes sRGB decoding
before bilinear interpolation, channel/factor separation, repeat addressing,
UV transforms and opaque alpha. This is numerical behavior, not performance.

`tools/trellis-support-witness.mjs URL OUTPUT_DIRECTORY INDEPENDENT_CHROMIUM`
uses Playwright Core or `KAMINOS_PLAYWRIGHT_MODULE`, an independent browser,
a private profile and mock Keychain. It exercises actual controls, exact source
and served module hashes, source-geometry LOD suppression/restoration, original/
partition/support/isolated views, both routing-preview branches and the curved
rim example. Full candidate and query data, screenshots, and an independent
PNG point-sampling reference are retained. Setup failures retain a terminal
report, including a missing local inspection dependency.

Saved-asset inspection and small native checks run directly. Heavy source
processing, actual training and performance assays use Greenroom with the
corresponding source/config identity and operator assay boundary.
