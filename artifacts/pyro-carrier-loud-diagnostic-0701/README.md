# Pyro Carrier Loud Diagnostic 2026-07-01

This slice makes Pyro Bite/Fold testable by eye before we tune them for taste.

What landed:
- `Carrier View` isolates `normal`, `border`, `bite`, `fold`, or `all` carrier paths.
- `Pyro Drive` overdrives subtle carriers up to `8x`.
- Diagnostic isolate modes add loud false-color opacity so a broken or too-subtle carrier fails loudly.
- Normal mode keeps the carrier subordinate to live simulation authority and uses Bite/Fold as load-bearing opacity/color perturbations, not freestanding ornamental fire.
- The readout now reports carrier view, drive, and `border/bite/fold` signal maxima.

Operator route:

```text
http://127.0.0.1:8099/?kaminos_volume_smoke=1&volume_tall_preset=operator_memory_fire_0701&volume_pyro_detail=1&volume_pyro_material_gain=1.5&volume_pyro_carrier_view=all&volume_pyro_overdrive=6&volume_quality_reason=pyro-carrier-all-loud-0701
```

Visual read:

- `all-loud.full.png`: loud diagnostic composite; cyan/white live plume body, not fake standalone fire.
- `normal-overdrive.full.png`: the same tall-plume basin with normal rendering plus overdriven load-bearing Bite/Fold.
- `bite-only.full.png`: red/orange lower live-fire carrier; smoke body is mostly suppressed.
- `fold-only.full.png`: cyan/blue smoke-body carrier; fire contribution is suppressed.
- `fuel-off.full.png`: fuel-off reset control; faint smoke remains, but Pyro material memory and carrier signals die.

Receipts:

| Capture | Witness | Carrier debug | Reset/debug state |
| --- | --- | --- | --- |
| `all-loud.json` | pass | `all / 6x / 9.00/9.00/7.06` | sampleable, confidence `1.00`, live fire authority `1.00` |
| `normal-overdrive.json` | pass | `normal / 6x / 9.00/9.00/7.06` | sampleable, confidence `0.88`, live fire authority `1.00` |
| `bite-only.json` | pass | `bite / 8x / 0.00/12.00/0.00` | sampleable, confidence `0.99`, live fire authority `1.00` |
| `fold-only.json` | pass | `fold / 8x / 0.00/0.00/9.41` | sampleable, confidence `0.99`, live fire authority `1.00` |
| `fuel-off.json` | expected visual-threshold fail | `all / 8x / 0.00/0.00/0.00` | `blocked-reset`, reset reason `fuel-off`, confidence `0.00`, live fire authority `0.00` |

The fuel-off report failed the old no-fire pixel classifier because the remaining smoke was too dark for its lit-pixel threshold. The semantic reset evidence is the important part for this lane: material gain dropped to `0`, shader readiness became `blocked-reset`, and all carrier maxima were `0`.

Commands rerun after the final patch:

```sh
node tests/volume-contracts.mjs
node --check volume-core.js
git diff --check
node volume-witness.mjs --url "http://127.0.0.1:8099/?kaminos_volume_smoke=1&volume_tall_preset=operator_memory_fire_0701&volume_pyro_detail=1&volume_pyro_material_gain=1.5&volume_pyro_interface_focus=1&volume_pyro_edge_bite=1&volume_pyro_smoke_fold=1&volume_pyro_debug_tint=0&volume_pyro_carrier_view=all&volume_pyro_overdrive=6&volume_quality_reason=pyro-carrier-all-loud-0701" --out artifacts/pyro-carrier-loud-diagnostic-0701/all-loud.png --report artifacts/pyro-carrier-loud-diagnostic-0701/all-loud.json --full-screenshot artifacts/pyro-carrier-loud-diagnostic-0701/all-loud.full.png --settle-ms 12000 --window-size 1600,1100 --debug-port 9451 --evidence-mode pyro-material
node volume-witness.mjs --url "http://127.0.0.1:8099/?kaminos_volume_smoke=1&volume_tall_preset=operator_memory_fire_0701&volume_pyro_detail=1&volume_pyro_material_gain=3&volume_pyro_interface_focus=0&volume_pyro_edge_bite=1&volume_pyro_smoke_fold=0&volume_pyro_debug_tint=0&volume_pyro_carrier_view=bite&volume_pyro_overdrive=8&volume_quality_reason=pyro-carrier-bite-only-0701" --out artifacts/pyro-carrier-loud-diagnostic-0701/bite-only.png --report artifacts/pyro-carrier-loud-diagnostic-0701/bite-only.json --full-screenshot artifacts/pyro-carrier-loud-diagnostic-0701/bite-only.full.png --settle-ms 12000 --window-size 1600,1100 --debug-port 9453 --evidence-mode pyro-material
node volume-witness.mjs --url "http://127.0.0.1:8099/?kaminos_volume_smoke=1&volume_tall_preset=operator_memory_fire_0701&volume_pyro_detail=1&volume_pyro_material_gain=3&volume_pyro_interface_focus=0&volume_pyro_edge_bite=0&volume_pyro_smoke_fold=1&volume_pyro_debug_tint=0&volume_pyro_carrier_view=fold&volume_pyro_overdrive=8&volume_quality_reason=pyro-carrier-fold-only-0701" --out artifacts/pyro-carrier-loud-diagnostic-0701/fold-only.png --report artifacts/pyro-carrier-loud-diagnostic-0701/fold-only.json --full-screenshot artifacts/pyro-carrier-loud-diagnostic-0701/fold-only.full.png --settle-ms 12000 --window-size 1600,1100 --debug-port 9454 --evidence-mode pyro-material
```
