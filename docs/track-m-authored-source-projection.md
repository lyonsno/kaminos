# Track M Authored Source Projection

The Track M source projection converts a saved Blender constructional-model scene into a deterministic, byte-bound anatomical relation graph. It is a source-arrival compiler. It does not render the three evidence conditions, select a tested anatomical relation, or clear the Track M musculature evidence hold.

## Two-stage contract

`tools/blender-track-m-source-extract.py` opens the requested `.blend` file read-only in Blender and emits `kaminos.track-m-blender-extraction.v0`. The extraction records:

- requested and effective source paths, byte length, and SHA-256;
- effective Blender version, scene frame, and unit declaration;
- every scene object's name, parent, collection paths, world transform, and normalized custom properties;
- local mesh or curve content hashes and primitive counts;
- authored modifiers that change source shape, including complete Mirror settings.

The extractor never saves, resaves, or exports the opened scene. If it fails, it writes `kaminos.track-m-blender-extraction-failure.v0` and admits no source graph.

`tools/compile-track-m-source-projection.mjs` validates that extraction against the caller-supplied source SHA-256 and emits `kaminos.track-m-authored-source-graph.v0`. The compiler preserves CMK identity and relationship fields directly:

- muscle construction, instance, lineage, variant, and authored completeness;
- origin, belly, insertion, routed path, and provisional surface components;
- authored endpoint route and strategy;
- origin and insertion source-object identity;
- source-mesh, provisional-muscle-surface, self-reference, and unclassified endpoint authority;
- missing WIP components and absent semantic-marker roles as explicit non-claims.

Output ordering and `graphSha256` are deterministic. Existing WIP omissions remain visible. An extant component whose role, parent, or lineage contradicts its muscle rig fails compilation.

## Invocation

Blender execution is a GPU Greenroom-protected route in this shop. Submit the exact command through the structured command conversion emitted by the route guard.

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background /path/to/source.blend \
  --python /path/to/kaminos/tools/blender-track-m-source-extract.py \
  -- \
  --source /path/to/source.blend \
  --out /path/to/raw-extraction.json \
  --failure /path/to/extraction.failure.json \
  --expected-source-sha256 <source-sha256>

node /path/to/kaminos/tools/compile-track-m-source-projection.mjs \
  --input /path/to/raw-extraction.json \
  --out /path/to/source-graph.json \
  --failure /path/to/projection.failure.json \
  --expected-source-sha256 <source-sha256>
```

The host compiler's failure report distinguishes requested and effective extraction paths, records the raw extraction hash, names the failure phase, and preserves the last trustworthy evidence even when no primary graph is written.

## Consumer boundary

The first consumer is the anatomical-relation selector. It may use the graph to select and specify a source-authorized Track M relation. The three-condition bundle remains the exact predecessor at `cc/molten-track-m-evidence-bundle-0802`; source projection does not alter its comparison classes or its publication gates.
