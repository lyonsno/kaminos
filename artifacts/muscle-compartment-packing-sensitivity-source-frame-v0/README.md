# K8 source-frame retention sweep

This deterministic visual assay applies the `source-frame-halfspace` formation constraint to the exact synthetic K8 `attachment-0550` derivation at three declared curvature-projection ratios. Every output is residual-bearing diagnostic geometry, not packing admission.

Live workbench route while the repository server is running:

`http://127.0.0.1:8765/artifacts/muscle-compartment-packing-sensitivity-source-frame-v0/`

## Inspected result

| Variant | Pairwise overlap | Skeletal penetration | Bend retention | Curvature cosine | Tangent cosine | Visual disposition |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `curvature-retention-030` | `0.724714628407` | `0` | `0.09` | `1` | `0.922126906139` | rejected: over-straightened bellies and visible pairwise residual |
| `curvature-retention-050` | `1.250012806456` | `0.065151584927` | `0.25` | `1` | `0.963711985711` | rejected: recognizable bow, but pairwise and skeletal residuals |
| `curvature-retention-070` | `1.926340495376` | `0.14050555392` | `0.49` | `1` | `0.988274387091` | rejected: strongest formation retention, worst remaining clearance |

All three outputs preserve fixed endpoints, exact target volume, compartment bounds, finite positive radii, source curvature direction, and zero tangent reversals. The sweep establishes a visible tradeoff: independent per-muscle source-frame projection prevents the prior folded/radial-cylinder failure, but higher formation retention reintroduces bone and muscle collision. The next mechanism must coordinate inter-muscle displacement or allocate compartment sectors while retaining these per-muscle formation bounds; lowering the ratio until the old visual failure returns is not an admissible redirect.

## Identity and replay

- Source bytes: `../muscle-compartment-packing-sensitivity-attachment-v0/source.json`
- Source SHA-256: `0577bc78607bc418b5cee376f09a7fb5b23018be3b3de04e9bfab16749e9d2b3`
- Request: `request.json`
- Run: `run-3e4e8aaaa37ce0d874ac`
- Assay report: `report.json`
- Agent visual input: `inspection.json`
- Bound visual receipt: `visual-inspection.json`
- Requested/effective orbitable route: `muscle-compartment-packing-sensitivity-orbitable-v0`, no fallback
- Requested/effective capture route: `independent-headless-screenshot-v0`, explicit Playwright Chromium headless shell, installed stable Chrome false, no fallback

Replay the assay from the repository root:

```sh
node tools/run-muscle-compartment-packing-sensitivity.mjs \
  --source artifacts/muscle-compartment-packing-sensitivity-attachment-v0/source.json \
  --request artifacts/muscle-compartment-packing-sensitivity-source-frame-v0/request.json \
  --out artifacts/muscle-compartment-packing-sensitivity-source-frame-v0 \
  --report artifacts/muscle-compartment-packing-sensitivity-source-frame-v0/report.json
```

Capture each variant with `muscle-compartment-packing-capture.mjs` using an explicit independent headless-shell executable, inspect the PNG bytes, write `inspection.json`, then bind the judgment:

```sh
node tools/admit-muscle-compartment-packing-sensitivity-visual.mjs \
  --out artifacts/muscle-compartment-packing-sensitivity-source-frame-v0 \
  --report artifacts/muscle-compartment-packing-sensitivity-source-frame-v0/report.json \
  --inspection artifacts/muscle-compartment-packing-sensitivity-source-frame-v0/inspection.json \
  --receipt artifacts/muscle-compartment-packing-sensitivity-source-frame-v0/visual-inspection.json
```
