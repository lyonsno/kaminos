# K8 transition-refinement visual assay

This deterministic orbitable assay tests whether source-preserving six-knot refinement plus a scalar attachment-bridge radial reference can relieve the fixed-attachment transition fan left by the reviewed four-knot chiral-belly carrier. All three rows use the same exact provisional K8 `attachment-0550` derived source. The result is an all-rejected mechanism tradeoff, not packing or anatomical admission.

Live workbench route while the repository server is running:

`http://127.0.0.1:8765/artifacts/muscle-compartment-packing-sensitivity-transition-refinement-v0/`

## Inspected result

| Variant | Pairwise overlap | Skeletal penetration | Bend retention | Curvature cosine | Reversals | Visual disposition |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `refined-source-knot-025` | `0.35338087219` | `0` | `1` | `-0.553496842305` | `16` | rejected: recognizable bow, but faceted/crossing transition construction |
| `attachment-bridge-005` | `0.031088011222` | `0` | `0.012762317955` | `0.485321985648` | `0` | rejected: numerically relieved but visibly straightened into generic cylinders |
| `attachment-bridge-025` | `0.086124145498` | `0` | `0.237630202608` | `0.000002832261` | `0` | rejected: some bow returns, but an S-like faceted transition remains |

The assay falsifies scalar-envelope refinement as the next packing mechanism. Extra longitudinal degrees of freedom are real, and attachment-anchored radial allocation exposes clearance leverage, but one shared scalar envelope cannot preserve the source construction while clearing the transition. The next mechanism must allocate curvature and radial motion per construction or relation rather than weakening the visual gate or adding another global relaxation coefficient.

## Identity

- Parent refined source file SHA-256: `876ea27a0c1a19315fc446161f834c255d5aaf53a3de5364773b7ef9fba8be24`
- Parent refined source semantic SHA-256: `ea9b979b8705a5299c7f9c244dd2ef21375d02c77a2b5b943c247731218523ce`
- Derived `attachment-0550` source SHA-256: `4c8f67416748af6cd1fb56eeb93613d9fd3f885166846cf230f2b06df7fcd813`
- Request SHA-256: `dcb7701c486f39777a86486619f1ebddf146bf058cd924e0185cbc6ef50dfe38`
- Run: `run-c24145bd0bad9738ef8d`
- Final report SHA-256: `e9624824af376b658816c12ee9f8e3cb6518f1e95893075e4fb6a6c000ac9445`
- Final visual receipt SHA-256: `c625b68218543c8267f62b9f26d777de7208a87ecc442225eb0ff787e4c609bb`
- Portfolio SHA-256: `9dc60e218a7b1b9a03d61a262c0cbe4760341206a858f3d049ee53e2c272ae67`
- Requested/effective orbitable route: `muscle-compartment-packing-sensitivity-orbitable-v0`, no fallback
- Requested/effective capture route: `independent-headless-screenshot-v0`, explicit Playwright Chromium headless shell, installed stable Chrome false, no fallback

The harness rejected two pre-evidence attempts before this run: first an internal semantic SHA was supplied where full source-file identity was required; then an ephemeral process-substitution source became empty before the post-run immutability check. The successful run uses a separate durable source JSON whose before/after SHA-256 is identical.

## Replay

From the repository root:

```sh
node tools/run-muscle-compartment-packing-sensitivity.mjs \
  --source artifacts/muscle-compartment-packing-sensitivity-transition-refinement-source-v0/source.json \
  --request artifacts/muscle-compartment-packing-sensitivity-transition-refinement-v0/request.json \
  --out artifacts/muscle-compartment-packing-sensitivity-transition-refinement-v0 \
  --report artifacts/muscle-compartment-packing-sensitivity-transition-refinement-v0/report.json
```

After explicit independent-headless capture and direct pixel inspection, bind `inspection.json` with:

```sh
node tools/admit-muscle-compartment-packing-sensitivity-visual.mjs \
  --out artifacts/muscle-compartment-packing-sensitivity-transition-refinement-v0 \
  --report artifacts/muscle-compartment-packing-sensitivity-transition-refinement-v0/report.json \
  --inspection artifacts/muscle-compartment-packing-sensitivity-transition-refinement-v0/inspection.json \
  --receipt artifacts/muscle-compartment-packing-sensitivity-transition-refinement-v0/visual-inspection.json
```
