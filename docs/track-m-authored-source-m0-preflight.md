# Track M Authored-Source M0 Preflight

This preflight connects an authenticated authored-source graph to the existing Track M M0 comparison contract without treating extracted geometry as anatomical authority.

## Inputs

The CLI requires caller-supplied paths and expected identities:

```sh
node tools/track-m-authored-source-m0-preflight.mjs \
  --graph /path/to/source-graph.json \
  --bundle-source /path/to/track-m-bundle-source.json \
  --routing-fixture /path/to/source-routing-fixture.json \
  --expected-graph-sha256 GRAPH_SHA256 \
  --expected-source-sha256 SOURCE_SHA256 \
  --expected-routing-fixture-sha256 FIXTURE_SHA256 \
  --output /path/to/preflight-report.json
```

No path or identity falls back to a repository default. The report records each requested path, canonical effective path, byte length, and byte SHA-256. The unchanged Track M evidence plan is rebuilt deterministically from the supplied bundle source, and the report names that effective route.

Read or parse failure still writes a report when `--output` was supplied. The report names the failure phase and last trustworthy input receipts instead of presenting missing validation as evidence.

## Authority Boundary

The graph can satisfy source identity, units, authored construction inventory, component lineage, raw geometry, and transform fields. It cannot choose the tested relation fixture or supply the missing M0 semantics, transform ledger, tolerances, camera, pose pair, budget witnesses, or independence evidence.

The adapter therefore emits `HOLD_MUSCULATURE_SOURCE_EVIDENCE` until those fields exist. Graph substitution, source substitution, self-hash drift, stale bundle plans, incomplete selected constructions, and provisional endpoint selection fail as contradictions.

## Caller Routing-Fixture Adapter

The caller supplies a reviewed, semantic-hash-bound routing fixture. The fixture names one primary route, one matched wrong-route donor in the same ordered source-object family, and two same-object null controls. The caller must also supply the fixture's expected semantic SHA-256; the validator does not discover or self-authorize a selection.

Pass that document with `--routing-fixture` and bind it with `--expected-routing-fixture-sha256`. The adapter verifies the producer's semantic hash domain, source and graph identities, compiler contract, selected construction order, same-object null identities, and explicit claim boundary. It then requires four distinct, complete constructions with `source_mesh` endpoint authority and equal construction budgets. The primary and matched donor must share the same ordered origin/insertion source-object family; each null must begin and end on one source object.

The consumer independently verifies the raw fixture fields. For both selected routes, the matched-wrong condition must preserve the entire correct route and origin. Its only permitted change is to take the paired donor's insertion assignment while retaining the receiving route's authored insertion-handle identity. This direct check is intentional: the current producer-side aggregate validator is held because a recomputed fixture could otherwise swap origins and still satisfy its aggregate receipts. The preflight does not cite that producer validator as evidence.

The adapter does not choose the fixture, construct a cross-wire transform, freeze a tolerance, or grant superiority, M0, station, pose, registration, or rendering authority. A valid fixture removes only `matchedControlIdentity` from the missing ledger and remains `HOLD_MUSCULATURE_SOURCE_EVIDENCE`.

Selection chronology remains caller-asserted. A matching fixture authority id and semantic hash prove which reviewed artifact was consumed, not when or why its selection was made.

## Authenticated Cat Exercise

The preserved report at `artifacts/track-m-cat-armature-m0-preflight-0803/cat-armature.m0-preflight.json` exercised graph `f11075a8f7afcb913c23190cfa78dd9b73401b840b0a2df8fc96bfaacbcdbcb0` against source `a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3`.

It returned a contradiction-free HOLD with 68 total constructions, 51 complete source-mesh relation candidates, 12 relations touching at least one provisional surface, and 7 explicitly incomplete constructions. This is a lawful source-routing sensitivity handoff, not M0 admission.

The exact reviewed fixture is preserved at `fixtures/track-m-routing/m31-m47-routing-fixture.json`. Its semantic SHA-256 is `1414edfd845300d5590ed4cd885e35a19430edeca682a14aee5f4bcebb828e28`; its byte SHA-256 is `ed0b95da9cdb7560e877869ab7d1f92423f8ec343712dbf40986ed63e5b48075`. It binds primary `muscle-31`, matched donor `muscle-47`, and same-object nulls `muscle-35` and `muscle-38` to the authenticated graph.

The consumed receipt at `artifacts/track-m-cat-armature-m0-preflight-0803/cat-armature.m31-m47-fixture.m0-preflight.json` records `originsPreserved: true`, `insertionAssignmentsOnlyChanged: true`, and `matchedRoutePreservation: direct_fixture_field_assertion`. The remaining ledger still holds semantic names, local frames, attachment/insertion bindings, routed path controls, tendon/belly intervals, wrap guides, the neutral pose pair, camera, packing behavior, matched-budget witnesses, neighboring-support independence, and source-evidence checks.
