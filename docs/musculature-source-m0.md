# Track M Musculature Source M0

The Track M M0 validator admits one caller-supplied shape-bearing musculature
receipt. It does not run Blender, infer anatomy, render evidence, or borrow a
pass from the Track R station, relational six-cell matrix, or projection
compiler.

## Dispositions

`validateMusculatureSourceM0(receipt)` returns exactly one disposition:

- `PASS_MUSCULATURE_SOURCE_ONLY`: the complete receipt preserves and resolves
  every required Track M identity and evidence check.
- `HOLD_MUSCULATURE_SOURCE_EVIDENCE`: the receipt is absent, or its otherwise
  valid structural contract identifies source omissions or explicitly says
  exact evidence is pending.
- `FAIL_MUSCULATURE_SOURCE`: a supplied contract is malformed, cross-references
  drift, or completed evidence fails or belongs to another source/control pair.

Transport failures are not M0 dispositions. The CLI writes
`kaminos.musculature-source-m0-report.v0` with `status: failed-to-validate`, a
failure phase, and the last trustworthy input hash when it cannot read or parse
the requested receipt.

## Caller-Owned Contract

The caller supplies all asset-specific names and values. The validator checks:

- track, receipt, exact source path/hash/completeness, known omissions, and
  matched-control identity;
- units and nondegenerate right-handed local frames;
- unique semantic support, attachment, insertion, path, control, interval, and
  wrap-guide names;
- attachment-to-insertion and local-frame references;
- routed path membership, source-local control positions, and ordered tendon
  and belly intervals;
- content-addressed wrap-guide geometry;
- a distinct neutral/conservative pose pair under one external pose authority;
- one fixed, content-addressed camera and one declared, content-addressed
  packing or volume behavior;
- a caller-named route-to-cast relation exercised under exact absent, correct,
  and preregistered matched-wrong condition identities;
- pairwise-distinct condition transforms, content-addressed relation and
  destruction witnesses, and a content-addressed matched-budget ledger;
- caller-declared nonnegative routing-budget values and tolerances for
  primitive, curve, control, cross-section, length, volume, and area fields;
- exact neighboring-support coverage and unchanged local-shape identity;
- complete evidence bound to the same source and control identities.

Extra station fields, relational cells, or compiler receipts are ignored. They
cannot fill a missing Track M field or promote pending evidence.

## Exact Consumer Exercise

```sh
node musculature-source-m0-validator.mjs \
  --input fixtures/track-m-musculature-source-m0.complete.v0.json \
  --output /tmp/kaminos-track-m-m0-report.json
```

The committed fixture is synthetic and exists to exercise the public contract.
Its pass proves validator behavior only. Replace `--input` with the exact
operator/Blender receipt when that receipt arrives; do not edit the validator,
schema, or thresholds to fit the specimen.

The content hashes make receipt substitution and condition collision visible;
they do not make a JSON declaration self-proving. The Blender/source producer
still owns the referenced source, transforms, route witnesses, and budget
ledger. The downstream Track M shape-bearing oracle station owns the later
geometry and image measurements. A station result cannot substitute for M0,
and M0 cannot substitute for the station.

Focused verification:

```sh
node tests/musculature-source-m0-contracts.mjs
node tests/musculature-source-m0-cli-contracts.mjs
node tests/structural-source-assay-contracts.mjs
```

Passing M0 does not establish image quality, semantic survival, deformation
quality, poseability, generation success, R0, shared exemplars, or box release.
