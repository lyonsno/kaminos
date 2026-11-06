# Independent geometry and surface detail

For levels with compatible appearance products, the beauty controller selects
geometry using projected geometric deviation and the scene face budget. Texture
density no longer forces a more detailed mesh for those levels.
Compatible appearance variants are chosen separately from projected texel size
and `textureBudgetBytes`. The default texture budget is unlimited; this renderer
does not expose a trustworthy automatic device-memory allowance. A caller may
set a measured or authored working-set budget without changing the face budget.
The native Render inspector accepts MiB, with blank meaning unlimited.

Camera rendering also has a surface-preserving intermediate. Default mesh
preparation adds a 100k-face direct simplification of the stored hero alongside
the five closed proxy targets. Sources already below that target keep their
original geometry. The intermediate uses a 2K source-baked material bundle;
its independent appearance products follow the same texture policy as other
geometry. Actual face counts, source-relative error and boundary facts are
recorded. The scene face budget remains a hard allocation limit.

These records carry `purpose:"beauty"`. The default mesh-LOD HTTP catalog and
choice contain shared levels, preserving older shadow/collision clients.
An additive `beautyLevels` catalog includes shared and beauty-only geometry for
the camera controller. Explicit `purpose=beauty` requests select from that
catalog, including when a route is specified. Shadow, collision and thermal
consumers continue to use the shared catalog. A closed flag on a beauty record
does not widen its eligibility.

On disk the restricted records live in a separate `beautyLevels` array, while
the original `levels` array retains shared proxies. The `beauty-lod` ingest
role stores their immutable GLBs under `.lod-beauty/`, addressed through the
ordinary digest URL. Older servers ignore that sidecar field and hidden asset
directory. Updated indexing, appearance registration and scene imports carry
the beauty geometry and its dependencies. The HTTP `beautyLevels` field is
the shared-plus-beauty catalog; the on-disk field contains only restricted
records.

Existing geometry is retained when preparation fills missing products.
Offline callers can add only the intermediate with `--targets none --beauty-targets 100000` on
`tools/prepare-lod-tiers.mjs`; `--beauty-targets none` preserves proxy-only
preparation. Source/target identity makes completed preparation reusable.

Stored mesh arrival and ordinary ingestion use the `surface-detail-v1`
preparation profile. `GET /api/mesh-lods` reports additive `preparation`
coverage: missing shared targets, a missing 100k beauty target when the source
is larger, and missing source-sized appearance variants for each geometry.
The source and image headers determine these requirements; a small or
untextured source needs no unnecessary intermediate or appearance products.
The source-size pyramid uses the same existing 256-pixel floor as appearance
preparation. Catalog coverage also checks that registered dependency files
exist. It does not rehash every immutable product during scene loading.

Ordinary stored-mesh queries enroll missing products in background preparation.
`prepare=client` observes without enrollment, including generation/import calls
that already own their preparation. Existing usable geometry remains visible
while queued work completes, then the live catalog refreshes. Repeated
preparation preserves registered geometry and reuses completed appearance.
Partial or unsupported preparation retains the existing source and products;
its status remains explicit.

When Greenroom is configured (including the installed default), server
preparation submits one command job per source and profile. A shared on-disk
submission record deduplicates pending jobs across servers. Each eligible arrival
is submitted immediately, and GET observes persisted queue state after a server
restart. The recorded
server endpoint must remain available for that queued job's storage calls.
The command checks its committed source revision before importing preparation
code. Receipt success, the terminal preparation report and current coverage
are separate requirements for completion. A registered product whose immutable file is missing stops preparation with an
explicit restoration error; metadata alone cannot establish completion.
Failed jobs retain their evidence;
an explicit `submit_mesh_lod_prepare(..., retry=True)` or an admitted rerun of
the offline CLI can retry. A machine without Greenroom keeps its existing
local offline runner. Raw job/state reports are under the chosen mesh store's
`.lod-prepare-reports/` directory.

`prepareMeshTextureLevels` in `lod-texture-generation.mjs` prepares appearance for
stored geometry. `prepareGenerationLevels` invokes it after publishing new mesh
levels by default; `textureLevels:false` requests geometry preparation alone.
The existing completion route and the offline appearance tool can be used
separately. For example:

```sh
node tools/prepare-lod-textures.mjs \
  --source <hero-sha256> --geometry <level-sha256> \
  --server http://127.0.0.1:8095 --report /chosen/output/appearance.json
```

Without `--geometry`, it prepares the source and current triangle-mesh levels.
Without `--sizes`, source texture dimensions define a descending pyramid down
to the existing 256-pixel preparation floor (a smaller source remains smaller).
The expensive bake runs offline in the caller's admitted job. Repeated completed
preparation reuses registered products. Existing geometry is neither simplified
nor unwrapped during appearance preparation.

Each appearance GLB carries the exact base geometry, accessor layout, UVs,
placement and material bindings, with replacement embedded PNG images. Reduced
mesh maps are baked from the source onto their existing UVs. Normal rebaking
checks that the calculated tangent basis matches the original basis. Smaller
variants filter base color in linear light and average/renormalize normal
vectors. Original source images are resized directly for the hero. The supported
baking route is the existing embedded PNG/PBR route; compressed loader support
remains separately owned by `asset-texture-support.mjs`.

`POST /api/mesh-lod-textures` takes `source`, `geometry` and `variants`. All files
must already be stored and digest-correct. The server compares actual accessor
payloads, node placement, materials and bindings against the registered geometry,
reads PNG dimensions, and verifies the declared RGBA8 mip-chain byte cost. It
atomically appends `textureSets[geometry]` to the existing `.lods.json` under the
same source lock. This preserves immutable geometry level records. Existing
resolutions are immutable unless `supersede:true` is explicit; superseded texture
references are retained in `retiredTextureVariants`. GET exposes `textureSet`
on each applicable level and the source's set in top-level `textureSets`.
Catalog indexing hides appearance files as derived products. Cross-store scene
imports copy their digest-verified appearance dependencies too.

The ordinary GLB loader decodes the selected appearance. Before applying maps,
the runtime checks file identity, base geometry/UV signature and dimensions/cost.
It changes texture bindings on existing materials, preserving geometry identity,
object identity, editor selection, lighting adaptation and scalar properties.
Repetition copies share their object's maps and count once against texture cost.
Failed or stale loads retain the working maps; release invalidates pending work.
The inspector separates loaded map resolution, pending target and failure.

Only one upgraded map set per registered geometry is retained. Inactive managed
appearance is restored to its base maps and the upgraded textures are disposed.
Inactive base textures release their GPU allocation while retaining the source
images for ordinary fallback/reupload. CPU source-image caches, render targets,
environments, shadows and other renderer owners are outside this working-set
budget. The state reports allocation target bytes and current managed resident
bytes separately; a nonblank transition may temporarily exceed its target budget.
This is RGBA8 mip-chain accounting for these PNG products, not a physical device
heap measurement. Unknown legacy/compressed texture cost remains unmeasured.

Legacy levels awaiting appearance products retain their existing bundled maps,
texture-blur refinement guard and available texture choice. Once compatible
appearance products are prepared, their geometry selection becomes independent. Preparing appearance upgrades those levels
without changing their geometry records. Loading one legacy asset enrolls that
asset's missing products; catalog browsing does not start a library-wide bake.
The `lod-detail` Workbench experiment
loads a stored mesh into the ordinary editor for orbit/zoom and native inspector
budget edits. Its agent operations use the same scene detail controller.
