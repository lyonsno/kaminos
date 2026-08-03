# Track M Authored-Source M0 Preflight

This preflight connects an authenticated authored-source graph to the existing Track M M0 comparison contract without treating extracted geometry as anatomical authority.

## Inputs

The CLI requires caller-supplied paths and expected identities:

```sh
node tools/track-m-authored-source-m0-preflight.mjs \
  --graph /path/to/source-graph.json \
  --bundle-source /path/to/track-m-bundle-source.json \
  --selection /path/to/relation-fixture-selection.json \
  --expected-graph-sha256 GRAPH_SHA256 \
  --expected-source-sha256 SOURCE_SHA256 \
  --output /path/to/preflight-report.json
```

No path or identity falls back to a repository default. The report records each requested path, canonical effective path, byte length, and byte SHA-256. The unchanged Track M evidence plan is rebuilt deterministically from the supplied bundle source, and the report names that effective route.

Read or parse failure still writes a report when `--output` was supplied. The report names the failure phase and last trustworthy input receipts instead of presenting missing validation as evidence.

## Authority Boundary

The graph can satisfy source identity, units, authored construction inventory, component lineage, raw geometry, and transform fields. It cannot choose the tested relation fixture or supply the missing M0 semantics, transform ledger, tolerances, camera, pose pair, budget witnesses, or independence evidence.

The adapter therefore emits `HOLD_MUSCULATURE_SOURCE_EVIDENCE` until those fields exist. Graph substitution, source substitution, self-hash drift, stale bundle plans, incomplete selected constructions, and provisional endpoint selection fail as contradictions.

## Caller Selection Adapter

The caller may select one causal fixture by supplying one primary route, one matched wrong-route donor in the same ordered source-object family, and two same-object null controls:

```json
{
  "schema": "kaminos.track-m-authored-relation-fixture-selection.v0",
  "graphSha256": "...",
  "primaryConstructionId": "...",
  "matchedWrongDonorConstructionId": "...",
  "nullConstructionIds": ["...", "..."],
  "authority": {
    "id": "...",
    "sha256": "..."
  },
  "selectedBeforeOutputInspection": true
}
```

Pass that document with `--selection /path/to/selection.json`. The adapter requires four distinct, complete constructions with `source_mesh` endpoint authority and equal construction budgets. The primary and matched donor must share the same ordered origin/insertion source-object family; each null must begin and end on one source object. It then copies all construction and endpoint identities from the authenticated graph.

The adapter does not choose the fixture, construct a cross-wire transform, freeze a tolerance, or grant superiority, M0, station, pose, registration, or rendering authority. A valid fixture removes only `matchedControlIdentity` from the missing ledger and remains `HOLD_MUSCULATURE_SOURCE_EVIDENCE`.

## Authenticated Cat Exercise

The preserved report at `artifacts/track-m-cat-armature-m0-preflight-0803/cat-armature.m0-preflight.json` exercised graph `f11075a8f7afcb913c23190cfa78dd9b73401b840b0a2df8fc96bfaacbcdbcb0` against source `a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3`.

It returned a contradiction-free HOLD with 68 total constructions, 51 complete source-mesh relation candidates, 12 relations touching at least one provisional surface, and 7 explicitly incomplete constructions. This is a lawful selection handoff, not M0 admission.

The exact externally selected fixture is preserved at `fixtures/track-m-cat-armature-m31-m47-relation-fixture-selection.v0.json`. It binds primary `muscle-31`, matched donor `muscle-47`, and same-object nulls `muscle-35` and `muscle-38` to the authenticated graph. Its authority field preserves a public selection identity and the content hash of the external selection record without publishing private coordination paths.
