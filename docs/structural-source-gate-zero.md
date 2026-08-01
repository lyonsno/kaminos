# Structural Source Gate-0

Gate-0 admits an authored structural source to a projection attempt without
claiming that generation ran or that a visual result exists. The validator is
caller-parameterized: source, relation, camera, route, and product identities
come from the receipt rather than a repository singleton.

## Track boundary

`shape-bearing-musculature` and `generator-relational-sensitivity` are separate
tracks. The six-cell L/H matrix belongs only to the relational-sensitivity
track. The `composition-owner` authority owns any later comparison or composition
between them.

For each of `parent`, `positive`, and `negative`, L and H share one exact source
input hash. L requests clay, depth, and normal products. H requests those same
products plus the semantic-role mask. H is therefore a projection enrichment,
not another generated source.

## Source admission

`validateStructuralSourceGate` checks stable source and state identities, a
nondegenerate anatomical and bend frame, conservative motion, attachment and
support identities, and material/topology/semantic hashes. The relational
assay additionally requires:

- an explicit composition-owner source assignment;
- a complete golden-object measurement station;
- one bounded symmetric relation with parent, positive, and negative variants;
- exact source checks for occupied fit, rigid clearance, attachment continuity,
  fixed distal support, and conservative sweep;
- frozen camera, crop, denominator, geometry, semantic, and carrier identities;
- station, camera, and crop hashes derived from their canonical numeric payloads,
  so editing the measurements without changing the claimed identity fails;
- one finite nonnegative numeric tolerance shared by source admission and the
  projection compiler;
- one shared source input per variant across L and H.

The six cell channel lists are bound to the compiler's actual product contract;
renaming or substituting a channel in the assay cannot silently create a
different evidence class.

`buildStructuralSourceGenerationManifest` embeds the exact
`kaminos.asset-arrival-source.v0` receipt and the compiler-produced
`kaminos.asset-arrival-projection-plan.v0`. Its jobs remain
`source-validated`: effective route, product config hash, products, publication
identity, and output hash are null.

The compiler accepts a product only after validating the PNG signature, chunk
layout and checksums, decoded dimensions, color mode, decompression, row size,
and row filters. A MIME label, filename, or nonblank byte buffer is not image
evidence.

## Outcome admission

`validateStructuralProjectionOutcome` accepts exactly one of:

1. The path to a compiler report plus the path to its current publication
   pointer. The validator reads the exact bytes, validates the report
   independently, matches the manifest's compiler/source/relation/camera/route
   and cell identities, and requires the pointer to name and hash that exact
   immutable report.
2. The path to a durable compiler failure receipt bound to the same source and
   route with one recognized failure phase and no publication claim. The
   validator reads and hashes the exact failure bytes rather than trusting a
   caller-constructed object.

The manifest cannot satisfy its own outcome contract, and a report for a
different source, route, cell matrix, or immutable publication cannot be used
as evidence for it.

## Replay

```sh
node structural-source-assay-manifest.mjs \
  --input fixtures/phase-three-hip-cup-source-assay.v0.json \
  --output /tmp/kaminos-gate-zero-manifest.json
```

The CLI writes a durable failure report for argument, input-read, input-parse,
source-validation, and manifest-build failures. It records requested and
effective file paths plus the last trustworthy input hash.
