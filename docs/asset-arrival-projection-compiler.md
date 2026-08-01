# Asset-Arrival Projection Compiler

The asset-arrival projection compiler packages one source-linked relational assay into a deterministic six-cell projection set. Its active track is `generator-relational-sensitivity`. A shape-bearing musculature assay has independent source and evidence custody. The composition owner makes any later decision to bind both tracks to one exemplar.

## Generic Source Fields

Every projected asset supplies these fields without compiler defaults:

- `receiptId` and `asset.{id,blendPath,blendSha256}` identify the authored source.
- `parts[]` gives every separately addressable Blender object a semantic `roleId`, `objectName`, finite 4x4 `localFrame`, and `geometrySha256`.
- `camera` gives a stable object name, local frame, projection, uncapped requested width and height, and `cameraSha256`.
- `roleRegistry[]` assigns one unique positive mask value to every source role.
- `route.requestedRouteId` names a CPU route that supports the four projection products.

These fields describe asset arrival and projection identity. They do not assert a hip relation, musculature quality, or generator response.

## Relational-Track Fields

The L/H assay additionally supplies:

- `trackId: generator-relational-sensitivity`;
- `contract.requiredPartRoleIds`, chosen by the source-side relation contract;
- `relation.{id,regionId,scalarId,axisPartRoleId,participantRoleIds}`;
- bounded `parentValue`, `delta`, `lowerBound`, `upperBound`, and `maxDelta`;
- exact `parent`, `positive`, and `negative` variants, each with a scene id, input hash, relation value, spillover measurement, and passed source predecessor checks.

The current hip-cup fixture names socket, head, axis, and collar roles. Those names belong to that fixture and are not generic compiler requirements.

## Execution Contract

`compileAssetArrivalProjections()` calls its injected CPU renderer exactly once for each signed variant. Every call requests `clay`, `depth`, `normal`, and `semantic-role-mask` at the source camera's exact dimensions. The renderer must echo the requested route, source input hash, camera hash, and product-configuration hash. Route fallback, stale source/cache identity, missing or blank products, duplicate products, and dimension caps fail before publication.

The compiler publishes the three base products into both L and H from the same validated bytes. H adds only `semantic-role-mask`. This makes L/H base identity a construction invariant:

| Cell | Products |
| --- | --- |
| `L_parent`, `L_positive`, `L_negative` | clay, depth, normal |
| `H_parent`, `H_positive`, `H_negative` | clay, depth, normal, semantic-role-mask |

Each product records relative path, MIME type, dimensions, byte size, and SHA-256 identity. The report records source, part-set, role-registry, camera, relation, requested/effective route, product configuration, and per-variant renderer receipts.

## Publication And Failure

Compilation occurs in a sibling staging directory. A complete validated result atomically replaces the caller's output directory; a rerun removes stale products. A failed run leaves no partial output directory and atomically writes `<outDir>.failure.json` with the last trustworthy evidence and one exact phase:

- `source-validation`;
- `manifest-construction`;
- `render-dispatch`;
- `product-validation`;
- `publication`.

## Consumer Boundary

- The source provider supplies source identity and semantic object/frame receipts for the assigned track.
- The source validator checks the generic source envelope and consumes the relational compiler's exact six-cell identities.
- The composition owner decides source assignment, track composition, and Gate-0 admission.

The compiler establishes source-to-projection custody. Generator sensitivity, musculature quality, visual admission, and cross-track composition remain separate evidence claims.
