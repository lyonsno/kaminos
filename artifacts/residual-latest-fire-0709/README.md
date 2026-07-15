# Residual Apply-Scale Contract Probe — 2026-07-09

Purpose: verify that MLX residual training, saved model artifacts, browser JSON export, and the WebGPU browser shader all share an explicit residual apply-scale contract instead of relying on hidden hardcoded strength.

## Finding

The MLX trainer historically applied raw learned residual logits with a hardcoded `0.25` multiplier. Browser preview/export did not carry that multiplier as model data, so offline metrics and browser visual previews were not guaranteed to be the same application contract. This did not mean scaling experiments were invalid, but it made live preview strength harder to reason about and could hide future mismatches.

## Patch shape

- `volume-residual-upscale-mlx.py` now accepts and records `--residual-apply-scale`, default `0.25`.
- `volume-residual-greenroom-runner.py` forwards and receipts `residualApplyScale`.
- `volume-residual-browser-export.py` exports `residualApplyScale` and preserves explicit zero-valued fields.
- `volume-core.js` packs `residualApplyScale` into the browser residual buffer and multiplies it before edge/material/strength masks.
- Legacy browser residual JSON missing `residualApplyScale` keeps the old browser behavior via default `1.0`; newly exported models carry the trainer scale explicitly.

## Greenroom proof

Initial pre-repair probe failed before trainer execution because `/private/tmp/kaminos-mlx-residual-venv/bin/python` was a broken Python shim without a real venv site path and could not import MLX. The route was repaired by recreating `/private/tmp/kaminos-mlx-residual-venv` as a real venv and installing `mlx`, `numpy`, and `pillow`.

Saved-model probe job: `69f7204cd697`

Proof artifacts:

- `apply-scale-contract-probe-rerun-saved/greenroom-route-proof.json`: `mlxAvailable: true`, `mlxDefaultDevice: Device(gpu, 0)`.
- `apply-scale-contract-probe-rerun-saved/residual-report.json`: `residualApplyScale: 0.25`, `ignoredParams: null`.
- `apply-scale-contract-probe-rerun-saved/greenroom-runner-receipt.json`: `residualApplyScale: 0.25`, `ignoredParams: null`.
- `apply-scale-contract-probe-rerun-saved/model/model-artifact.json`: model and training config both carry `residualApplyScale: 0.25`.
- `apply-scale-contract-probe-rerun-saved/browser-direct-apply-scale-probe.json`: browser export carries `residualApplyScale: 0.25` and `residualOutputLimit: 0.15`.

Validation commands run:

```bash
node tests/residual-browser-contracts.mjs && node tests/residual-material-split-contracts.mjs
/private/tmp/kaminos-mlx-residual-venv/bin/python volume-residual-browser-export.py --model-artifact artifacts/residual-latest-fire-0709/apply-scale-contract-probe-rerun-saved/model/model-artifact.json --out artifacts/residual-latest-fire-0709/apply-scale-contract-probe-rerun-saved/browser-direct-apply-scale-probe.json
```

## Next research use

Use this branch/route for the larger exact-0.10 support curve point. The scaling question is still open; this patch prevents that experiment from being contaminated by a silent train/export/browser strength mismatch.
