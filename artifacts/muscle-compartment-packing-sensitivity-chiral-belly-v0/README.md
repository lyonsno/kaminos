# K8 chiral belly-turn assay

This deterministic orbitable assay compares the reviewed exact-frame `0.50` baseline with two explicitly requested mirror alternatives of the new `capsule-axis-belly-turn` carrier projection. Every row uses the same exact K8 `attachment-0550` derived source. Chirality is invocation input and receipt-bearing output, not solver-invented anatomy.

Live workbench route while the repository server is running:

`http://127.0.0.1:8765/artifacts/muscle-compartment-packing-sensitivity-chiral-belly-v0/`

## Inspected result

| Variant | Pairwise overlap | Skeletal penetration | Bend retention | Curvature cosine | Tangent cosine | Relation cosine | Visual disposition |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `exact-frame-050` | `1.250012806456` | `0.065151584927` | `0.25` | `1` | `0.963711985711` | `1` | rejected: source-sector lock leaves muscle and bone collision |
| `belly-turn-positive-025` | `0.239747847364` | `0` | `0.324163865646` | `0.337224139862` | `0.838445230146` | `0.906307787037` | rejected: coherent positive turn and cleared bone, residual transition-fan contact |
| `belly-turn-negative-025` | `0.239747847364` | `0` | `0.324163865646` | `0.337224139862` | `0.838445230146` | `0.906307787037` | rejected: mirrored coherent turn, same residual, no anatomical preference claimed |

Both belly-turn rows materially advance the accepted visual contract relative to the exact-frame baseline: whole bowed bellies negotiate space around the shaft instead of being ironed straight or locked into the source sectors. They preserve fixed attachments, exact volume, compartment bounds, finite positive radii, source longitudinal order, and zero curvature or relation reversals. They are not packing admission because continuous pairwise overlap remains at the transition from fixed attachments to the turned belly.

The next mechanism is local transition-segment relief composed with the retained belly turn. It must reduce the remaining `0.239747847364` residual without losing the current formation metrics or silently choosing chirality for an authored source.

## Identity

- Parent source SHA-256: `0577bc78607bc418b5cee376f09a7fb5b23018be3b3de04e9bfab16749e9d2b3`
- Request SHA-256: `454f20192315c03207d36c0b1cf3e9dcecc6b1e30134260f9ee4f31efd5b28f1`
- Run: `run-55bbb8baceeebaabb8a5`
- Final report SHA-256: `7cc0c5bff9d7a79c4d56ae85a82b8ba8883132e0b6631d92514650e602185ee1`
- Final visual receipt SHA-256: `a8b1f8c94341bbf74d16dfc7b70e4aed2fd7c0e84691d5843abde40bcbb44c92`
- Portfolio SHA-256: `99049765915d7456b546cb2fe9352dea0a1cd5088c1f3dc9b9a306ce279876d6`
- Requested/effective orbitable route: `muscle-compartment-packing-sensitivity-orbitable-v0`, no fallback
- Requested/effective capture route: `independent-headless-screenshot-v0`, explicit Playwright Chromium headless shell, installed stable Chrome false, no fallback

## Replay

From the repository root:

```sh
node tools/run-muscle-compartment-packing-sensitivity.mjs \
  --source artifacts/muscle-compartment-packing-sensitivity-attachment-v0/source.json \
  --request artifacts/muscle-compartment-packing-sensitivity-chiral-belly-v0/request.json \
  --out artifacts/muscle-compartment-packing-sensitivity-chiral-belly-v0 \
  --report artifacts/muscle-compartment-packing-sensitivity-chiral-belly-v0/report.json
```

After explicit independent-headless capture and direct pixel inspection, bind `inspection.json` with:

```sh
node tools/admit-muscle-compartment-packing-sensitivity-visual.mjs \
  --out artifacts/muscle-compartment-packing-sensitivity-chiral-belly-v0 \
  --report artifacts/muscle-compartment-packing-sensitivity-chiral-belly-v0/report.json \
  --inspection artifacts/muscle-compartment-packing-sensitivity-chiral-belly-v0/inspection.json \
  --receipt artifacts/muscle-compartment-packing-sensitivity-chiral-belly-v0/visual-inspection.json
```
