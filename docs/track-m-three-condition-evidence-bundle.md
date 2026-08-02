# Track M Three-Condition Evidence Bundle

## Purpose

The Track M bundle freezes one asset-independent comparison contract for testing whether deep musculature geometry contributes source-localized shape authority. It compares one exact source in one conservative pose under exactly three conditions:

1. `deep-geometry-absent`
2. `deep-geometry-correctly-routed`
3. `deep-geometry-matched-wrong-routing`

The contract can be parameterized when the operator-authored `.blend` and measurement-station instance arrive. Contract completion does not pass M0 and does not run a renderer, GPU route, image generator, spatial reconstruction, or visual admission.

## Reuse Disposition

The reviewed relational compiler at `4bcfd8c6` contributes generic custody invariants:

- SHA-256-bound source, camera, configuration, transform, output, and product identities;
- requested and effective route identity;
- immutable version publication authenticated by one atomic current pointer;
- path-read report and product-byte admission;
- exclusive success or durable failure evidence;
- phase-specific failure identity and last-trustworthy-evidence reporting.

Its public schemas and planner are not reusable for Track M. They encode `generator-relational-sensitivity`, signed parent/positive/negative variants, participant relations, the L/H matrix, and H-only role-mask enrichment. Importing those fields would let Track R semantics impersonate shape-bearing authority.

Track M therefore has one new public surface in `track-m-evidence-bundle-core.mjs`:

- `kaminos.track-m-evidence-source.v0`
- `kaminos.track-m-evidence-plan.v0`
- `kaminos.track-m-evidence-report.v0`
- `kaminos.track-m-evidence-current.v0`
- `kaminos.track-m-evidence-failure.v0`
- `kaminos.track-m-route-receipt.v0`

This is new semantic schema, not a second publication philosophy. Its publication and failure contracts deliberately retain the reviewed generic invariants.

## Frozen Comparison Identity

The source receipt names and authenticates:

- source asset id, path, and content hash;
- conservative pose id, external authority id, and pose hash;
- fixed camera id, projection, dimensions, and hash;
- fixed material and illumination ids and hashes;
- fixed render configuration id, dimensions, and hash;
- requested CPU-only route id and adapter-contract hash;
- a caller-supplied, unique product contract;
- tested relation id and deep-geometry semantic ids;
- deep-geometry content-set hash;
- attachment-endpoint multiset hash;
- expected routing-graph hash; and
- representational budget.

The representational budget currently freezes exact primitive, vertex, triangle, and parameter counts. The product contract remains caller supplied so Phantom's independent measurement station can require the channels it needs without redesigning this schema. Once supplied, the kinds, MIME types, dimensions, output identities, and product bytes are exact comparison authority.

## Condition Predicates

### Deep Geometry Absent

The absent transform must remove exactly the tested deep-geometry ids. Deep geometry and the tested relation are both absent. This condition is intentionally outside the matched-budget pair; it measures the effect of having no deep geometry.

### Correctly Routed

The correct condition retains deep geometry and the tested relation. Its content-set, endpoint multiset, routing graph, and representational budget must match the preregistered source identities.

### Matched Wrong Routing

The wrong-routing condition retains deep geometry while destroying the tested relation. It must:

- preserve the correct condition's deep-geometry content-set hash;
- preserve the attachment-endpoint multiset hash;
- preserve all representational-budget counts;
- carry a different routing-graph hash;
- name the exact destroyed relation; and
- authenticate the routing permutation independently.

Removing geometry, changing endpoint membership, changing mesh or parameter budget, or retaining the expected routing graph is a rejected comparison class.

## Plan And Output Identity

`buildTrackMEvidencePlan(source)` validates the source and creates the canonical three-condition order. Every condition receives the same source, pose, camera, material, illumination, render configuration, and dimensions, plus its explicit transform and a deterministic output identity. The complete plan and bundle output identities authenticate their current contents and are recomputed during outcome admission. Persisted plans are also reconstructed as canonical Track M sources and rerun through the source predicates before their hashes are trusted, so a caller cannot recompute public identities around a changed pose, comparison condition, route relation, or representational budget.

The plan does not claim an effective route or generated output. Those identities exist only in an admitted report or durable failure receipt.

The v0 source, report, condition, route-receipt, product, pointer, and failure objects have closed field sets. Track R fields are rejected rather than carried as ignored baggage.

## Outcome Admission

`validateTrackMEvidenceOutcome()` accepts exactly one evidence branch.

A successful branch requires:

- a path-read immutable report;
- a path-read current pointer that authenticates the report path and bytes;
- exact plan, source, track, route, condition, transform, and output identities;
- one complete product set per condition;
- requested/effective route equality in both the report and a separately hashed per-condition route receipt;
- CPU execution, no GPU requirement, preregistered adapter-contract identity, concrete backend identity, and exact route-receipt product agreement; and
- every product path, byte length, and SHA-256 verified inside the immutable version directory.

Products declared as `image/png` additionally require a valid PNG signature, chunk stream and CRCs, supported IHDR encoding, decoded dimensions matching the plan, a decodable pixel stream of the exact expected size, and legal scanline filters. A self-consistent hash receipt cannot make arbitrary bytes into admitted visual evidence.

Publication ids are single safe path segments. Report, route-receipt, and product realpaths must remain inside the immutable version directory, so lexical containment and symlinks cannot redirect admitted evidence to mutable external bytes.

A failed branch requires a path-read failure receipt bound to the exact compiler, track, plan, source receipt, requested route, bundle output identity, attempt, failure phase, and last trustworthy evidence. Success and failure evidence are mutually exclusive.

## Consumer Exercise

The Track M source-validator owner can compare validated source output to `buildTrackMEvidencePlan()` without assigning M0 passage. The independent measurement-station owner can declare the frozen product contract and later instantiate its station over the admitted report. The arrival-card compiler can bind the resulting source, bundle, and station evidence. The delayed-asset tranche coordinator can verify that the tranche has one comparison-consumable contract before the asset exists.

Focused verification:

```sh
node --check track-m-evidence-bundle-core.mjs
node --test tests/track-m-evidence-bundle-contracts.mjs
```

The tests challenge missing geometry disguised as wrong routing, unmatched budget, endpoint drift, surviving tested relation, Track R substitution and baggage, camera drift, GPU route substitution, missing adapter identity, stale plan identities, recomputed nested-plan baggage, recomputed semantic plan drift, honest and self-labeled route fallback, unsafe publication ids, symlink escape, detached report/pointer bytes, product-byte tampering, malformed plans, and ambiguous success/failure evidence.

## Claim Boundary

This contract can prove that one evidence bundle preserved the preregistered comparison identities and publication custody. It cannot prove that the operator source passes M0, that a renderer or effective production route exists, that any visible difference is meaningful, that deep geometry is shape-bearing, that the station passes, that deformation is plausible, or that Track M composes with Track R.
