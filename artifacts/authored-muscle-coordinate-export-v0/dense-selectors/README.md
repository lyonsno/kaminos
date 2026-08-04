# Dense selector candidate-authority receipts

These caller-addressed sidecars extend the same byte-bound 68-route parent atlas beyond the sparse M31/M47 subset without promoting any dense route geometry into source authority.

## Assessment

The nested Phantom/Golden selector sets are mechanically coherent in the current source graph. Every selected route in k4, k6, and k8 has candidate endpoint positions, native centerline, target-volume measurement, and volume classification. The original packages predate a reviewed dense routing fixture. Molten has since supplied an exact current-graph k4 fixture, now replayed separately under `k4-current-graph/`. That fixture admits all eight k4 endpoint positions and removes the old graph-binding conflicts; it does not admit centerlines, target volumes, volume authority, real-world units, compartments, or obstacles. The current-graph k4 rows therefore remain `candidate`, the receipt remains `authority-incomplete`, and no `coordinate-carrier.json` exists.

Each package contains a byte-identical replica of the canonical parent atlas so a consumer can verify the receipt without reconstructing or inferring parent state. Every replica has file SHA-256 `6a501353d62f1e8a61f86f6423ac687bad6c06a24e3e870bd4f843cdfec56749` and internal atlas SHA-256 `b9a857559f7d20e1efe18e0a29103ba7cb2347dc3e0b20ac0df409929af6b77b`.

## Exact selector receipts

| Selector | Ordered routes | Row states | Blockers | Receipt internal SHA-256 | Receipt file SHA-256 | Probe file SHA-256 |
| --- | --- | --- | ---: | --- | --- | --- |
| k4 | `muscle-34,muscle-13,muscle-12,muscle-45` | 4 candidate | 25 | `8c4b618c95f42c0eb2c657ca7dd3fc42c978de2d6e77a056b42ecceee320aa66` | `0154dbc704ea94ea1f87f906b1c817911c9a3b83783e1763c26ea9ad892e34f2` | `c47ccc991911e0200c2d0536379454e20a10c60c84899998bcf779702e465148` |
| k6 | k4 plus `muscle-18,muscle-14` | 6 candidate | 35 | `73d63d596827a4d459fbea94a284e1aa42b860523adf523d1cebba0785f98446` | `34bda8416014e597730f8d0e7801a1ede3c66fe8407d3756b4499c40acda1f8d` | `c3f21d2ddfca857aad45693b67be86e1cd3ec998e0cd6be2a4de15e1de02de46` |
| k8 | k6 plus `muscle-30,muscle-15` | 8 candidate | 45 | `29afbe80f0419c743641141c357183796a84f9b8424cc7382160df4046b9b182` | `49e22219e953582c8556f63ed2c218719e8d7d997fa3157cafd899e717283af5` | `483c42f19f6380cfbe109920f38075c5e136e7089183bffd2032578b4715a4f5` |

Requested routes, effective routes, derivation `selectedConstructionIds`, and receipt row order agree byte-for-byte in every package. The selectors are strictly nested; no request falls back to M31/M47 or reorders the source-frozen construction ids.

## Shared blockers

Every receipt retains the same five shared blockers before its route-local candidate fields:

- the reviewed M31/M47 routing fixture is bound to the older graph identity and file bytes;
- the current operator-path measurement-preserving graph has no source-authorized correspondence or supersession;
- Blender's scene-unit declaration is a candidate, not real-world unit authority;
- no named source-authority compartment exists; and
- no named source-authority obstacle membership exists.

The graph-binding delta is separately expressed as `candidate-graph-rebind.json`, file SHA-256 `8f6ecba2851d6df3e3f9a984bb82752e81d37eb7eb449244b4e2a276fe358dd9`. It records matching source bytes and exact M31/M47 route/component identities while leaving the replacement assay hash and fixture hash null. It is explicitly `candidate`, `admitted:false`, and `notAnAuthorityGrant:true`; it cannot remove receipt blockers or authorize a carrier.

## Current-graph k4 binding

Reviewed fixture `fixtures/track-m-routing/m34-m13-m12-m45-k4-selected-route-fixture.json` binds exact ordered routes `muscle-34,muscle-13,muscle-12,muscle-45`, source graph semantic SHA-256 `3f4c65867a776edfbf87bc59ca7a882b078b350078491f1822ccc9da0e426272`, and the original k4 authority-receipt file SHA-256 `0154dbc704ea94ea1f87f906b1c817911c9a3b83783e1763c26ea9ad892e34f2`. Replaying Bytebound's extractor against that fixture produces:

- parent atlas internal SHA-256 `8098190ddc3666e3152243c0943ccf5d28c7b9aa332b16956ed0bd709cde0f92`, file SHA-256 `658e126007fc66f4dd0ea6ab5bf957d8644e1b46d31eda3f6278f0cc6c61f8dd`;
- authority receipt internal SHA-256 `ef5b6cb016287c1f0428f4f77d15defd19e2bbbf9956cb980c5878923a54bc8d`, file SHA-256 `d3fdd4f5d6a49ae5efdce192a4ae57ba1f99ad63da9bf90a1c4686f47572cb16`;
- Packer probe file SHA-256 `be869a0a7fc53e3adb8f50f71baffdf16e795d4130db95925edb75fe1010f1fe`;
- Packer receipt internal SHA-256 `b71c2b7f19a5580d5bf0841ea929d725f72339b93e3913f3886e35a194526834`, file SHA-256 `420cff50cdc841119cd77ec71e9a6477aef9189602d272220c832e650f582b87`.

The authority receipt has zero binding conflicts. Packer accepts source, graph, fixture, selected construction/component identities, and all selected attachments, then returns `authority-incomplete` with exactly nineteen missing/candidate authority paths: three shared paths (`coordinateSpace.unit`, `compartment`, `obstacles`) and four route rows whose row state, centerline, target volume, and volume authority are not admitted. `conflictingFields` is empty and `packingSource` remains null. Two full exporter-plus-Packer executions produced byte-identical files.

## Consumer boundary

These receipts are suitable for Golden/Phantom dense comparison. They are not packing inputs.

The original dense diagnostic probes were exercised against the then-only M31/M47 fixture and correctly stopped earlier at `source-identity-mismatch`. Those historical wrong-fixture witnesses remain preserved as each original package's `packer-intake-receipt.json`:

| Selector | Packer status | Reason | Receipt internal SHA-256 | Receipt file SHA-256 |
| --- | --- | --- | --- | --- |
| k4 | `source-identity-mismatch` | selected ids do not match the routing fixture route set | `b3075b2d1e66bcf0ee5d3d4b0a8e6fb8902354d81d403b78392d30c818108c88` | `2fde60a285df497ae505de793f1c04a25323877cf382393af58f64dc7c868f68` |
| k6 | `source-identity-mismatch` | selected ids do not match the routing fixture route set | `8fe6abd7992a09e6dc65da055d7802f856c7d0001a5759a9f8482a4e4cc3b79b` | `394f374b2bcaf335d9b74609c3f2b9e9d59107750cffb57b7ce7d52a0d6e3621` |
| k8 | `source-identity-mismatch` | selected ids do not match the routing fixture route set | `e09b4ce3eb1654bbe12cb715ae1418b04f5cf697413a672d9b2de91d479d02c6` | `daee5a4cb518c51a0e7d13897c61ceff8a57fc25f3c4002611e9e3abd35cbc04` |

The reviewed current-graph k4 fixture now supplies that exact relation identity and lets Packer reach the intended authority-refusal boundary. K6 and k8 still have no reviewed matching fixture. The operator/source author owns every remaining promotion of centerline, target-volume, volume, unit, compartment, or obstacle authority. Packer still owns admission and correction refusal.
