# Track M M34/M13 Dense Routing Fixture

This fixture freezes Golden's selected `SRC_PELVIS -> Cube.002` routing-sensitivity assay inside the operator-authored cat armature's dense pelvis family. It compares one absent condition, the authored `Muscle 34` route, and a matched cross-wire that gives `Muscle 34` the insertion assignment authored for `Muscle 13`.

## Frozen Comparison

The authenticated source graph contains exactly 36 complete `SRC_PELVIS -> Cube.002` routes. `Muscle 34` and `Muscle 13` are the tested pair; the other 34 routes define the held neighborhood.

- `absent` removes both tested constructions and freezes the exact 34-route remainder that the executable consumer must preserve.
- `correct` retains both authored routes.
- `matchedWrong` swaps only the two insertion assignments.

The source endpoint coordinates freeze the comparison corridor before condition output. Cast projection, attachment-neighborhood radius, expected signed localization, and neighboring-route leakage remain unavailable or unmeasured and are explicitly held. Packing admission and station identity also remain downstream responsibilities.

## Measured Mismatch

The insertion cross-wire changes `Muscle 34`'s endpoint chord by 2.731012950405119% and `Muscle 13`'s by 0.5295978656482437%. These are observations from the authenticated source geometry. The fixture assigns no admissible tolerance, so those measurements do not authorize treating the cross-wire as budget-matched.

## Invocation

```sh
node tools/compile-track-m-routing-fixture.mjs \
  --selection src-pelvis-cube002-m34-m13-routing-sensitivity-v0 \
  --graph /path/to/cat-armature.source-graph.json \
  --assay /path/to/relation-geometry.json \
  --out /path/to/m34-m13-dense-routing-fixture.json \
  --failure /path/to/failure.json \
  --expected-source-sha256 <blend-sha256> \
  --expected-graph-sha256 <graph-identity> \
  --expected-graph-file-sha256 <graph-file-sha256> \
  --expected-assay-file-sha256 <assay-file-sha256>
```

The checked fixture is `fixtures/track-m-routing/m34-m13-dense-routing-fixture.json`. Its embedded `fixtureSha256` authenticates canonical semantic content; the JSON file has a separate byte hash.

Focused verification:

```sh
node --test tests/track-m-source-projection-contracts.mjs tests/track-m-routing-fixture-contracts.mjs
```

## Consumer Boundary

Golden is the joined comparison consumer. Mushfinger is the later executable consumer. The admitted claim is limited to an authenticated dense source-side routing fixture. The fixture does not establish a preferable route, cast-space localization, packing behavior, or a rendered anatomical result.
