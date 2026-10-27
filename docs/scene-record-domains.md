# Feature-owned scene records

A domain defines its authored payload beside its validators and constructors.
Install its contribution once in `scene-record-domains.mjs`. The ordinary record
constructor, serialization, document normalization, reloadability and source
reconstruction consume those same contributions. The application supplies actual
mount/load capabilities through `createSceneRecordOperations` in `index.html`.
Membership, history and whole-scene replacement keep their existing owners.

`inference-kiln-record.mjs` is a complete source-specific example. It owns the
prompt geometry decoder and the `promptRelief` payload; installing it requires
no prompt branch in the core serializer, persistence normalizer or source loader.
Camera, light, procedural geometry, fire and water supply their contributions
from their existing domain modules. File-backed assets keep their current URL
policies in `scene-asset-records.mjs`.

## Contribution shape

```js
export const featureRecordDomain = {
  type: 'pbr',
  source: 'kaminos:my-feature',
  check: record => checkedFeatureRecord(record),
  fields: record => ({feature: record.feature}),
  reloadable: record => {
    checkedFeatureRecord(record);
    return true;
  },
  load: (record, loaders, options) =>
    loaders.constructed(createFeatureObject(record), record, options),
};
```

`type` and `fields` are required. A source-specific contribution takes precedence
over its type's file-backed fallback; duplicate type/source installation fails.
`fields` projects the owned payload for admission, serialization and normalized
documents. The service copies that payload so callers do not share mutable
recipe data accidentally. `check` validates and normalizes the record using the
domain's actual rules. `reloadable` identifies supported reconstruction; thrown
validation errors produce `false`.

An optional `capture(entry, {readers, metadata})` reads current domain-owned
state when field projection alone is insufficient. Prompt geometry uses its
actual geometry at capture time. An optional `recognize(object)` identifies
roots constructed by that owner through explicit owner metadata. Conflicting
root owners fail rather than choosing by installation order. It is not a
geometry classifier.

`load` receives the application's declared loaders and invocation options,
including `activate` and `loadRequestId`. The existing source loaders retain
their publication/cancellation contracts. A domain constructor returns its real
object through an actual application mount; a producer-local decoded object
alone does not establish application integration.

## Evidence and limits

Exercise the feature through ordinary editing/history and real server
save/reopen, preserving its source, payload, references and authored transform.
Domain-unit tests can import `createSceneRecordOperations`; tests of application
composition exercise the mounted application. Keep malformed-source refusal and
existing scene/history/resource checks.

These records describe authored reconstruction. Evolved gas, water, thermal
state and debris need their own owner-supported continuation. An experiment's
owned/borrowed resource lifetime remains the scene-session contract. A file URL
passing its existing source policy does not prove remote bytes are available.
