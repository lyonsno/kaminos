# Appearance Transport Falsifier

Question: Is the one-step appearance residual head failing, or is learned local displacement handing that head the wrong transported donor state?

Result: Learned displacement is the dominant remaining error source in this matched-support comparison. The same frozen appearance residual improves both donor streams on all 63 held-out adjacent pairs, but oracle-correspondence transport plus the residual reaches aggregate state MSE `0.5141105`, versus `0.7101635` for learned transport plus the residual. Oracle transport is `27.61%` lower error than learned transport; learned is `38.13%` higher than oracle. Direct inspection shows coherent macro flame sheets in every role across the full 10.08 seconds, with the learned stream's residual discrepancy concentrated around thin crest ridges and wisps rather than a late one-step blur collapse.

## Inspect First

Open `inspection-guide.html`. It keeps each moving witness and contact sheet adjacent to its role, time, metric, and claim-boundary description.

- `appearance-transport-beauty.mp4`: 63 distinct adjacent held-out pairs at 6.25 fps, 10.08 seconds, non-looping. Columns are `REFERENCE | SOURCE REUSE | ORACLE DONOR | ORACLE RESIDUAL | LEARNED DONOR | LEARNED RESIDUAL`.
- `appearance-transport-debug.mp4`: the matched-support roles at additive display-only cohort gain `0.625`. It omits source reuse because that control has native differing support.
- `images/beauty-seven-time-contact.png`: rows are pair indices `0 / 10 / 20 / 31 / 41 / 51 / 62`, corresponding to target simulator times `0.16 / 1.76 / 3.36 / 5.12 / 6.72 / 8.32 / 10.08 s`. Columns retain the six beauty roles above.
- `images/debug-seven-time-contact.png`: the same seven temporal anchors and the five matched-support debug roles.

The reference is the exact held-out target on valid local donor support. Source reuse is the current source state with its native support and is not allowed to impersonate a matched-support prediction. Oracle donor uses exact source-to-target correspondence. Learned donor uses the highest-probability valid local displacement from the recurrent-exposure transport model. The two residual columns apply the exact same frozen nine-channel appearance model to those donor states.

## Quantitative Read

| Role | Aggregate state MSE | Residual reduction from donor | Beats paired donor |
| --- | ---: | ---: | ---: |
| Oracle donor | `0.8313272` | n/a | n/a |
| Oracle residual | `0.5141105` | `38.16%` | `63 / 63` pairs |
| Learned donor | `1.1150698` | n/a | n/a |
| Learned residual | `0.7101635` | `36.31%` | `63 / 63` pairs |

Oracle residual beats learned residual on `63 / 63` pairs. Learned displacement selected a transported donor at `2,102,098 / 4,016,659` matched destinations (`52.33%`) and the same site at `1,914,561` (`47.67%`). Its unconstrained occupancy head would have selected death at `1,060,821` destinations (`26.41%`), so the witness reports forced-valid donor quality rather than mixing donor error with support deletion. It excludes `361,980` unsupported target births from all matched roles.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch/harness head: `cc/pyro-phase-lag-counterfeiter-0713` at `383d8e5a1aa3d94845bdcf56d25a1c3f9a73f00f`
- Corpus: `receipts/evaluation-corpus.json`, SHA-256 `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`; 64 exact frames, 63 adjacent pairs, controlled `160 ms` step
- Appearance model: `receipts/destination-state-model.json`, SHA-256 `48c7bb6ad4ce0fedbac6e4cecb92d3f5cbc619a9bc718775f87b49867fb38e65`
- Transport model: `receipts/transport-model.json`, SHA-256 `88d5898448aed8ae1f92130e1a997f9ec6ef0301db0ac940ebf4794d36bc7645`
- Evaluation Greenroom job: `4612cc92ea92`, `705.65 s`, exit `0`, null timeout
- Backend/device: MLX `Device(gpu, 0)`, effective runner `/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python`, null fallback, null pair/sample caps
- Effective simulator route: `native-3d-compute-fluid-raymarch-v0`
- Evaluation report: `receipts/destination-state-evaluation.json`, SHA-256 `393f283480268072f8dea3a20e1881e2463a102f6bbfb48c6447a7ccea65dcbd`

Evaluation command recorded by Greenroom:

```sh
/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python -u boundary-splat-phase-state-evaluate-mlx.py --model /private/tmp/kaminos-phase-destination-state-physical-energy-anchored-online-h12-w1-r1-0715/destination-state-model.json --transport-model /private/tmp/kaminos-phase-transport-eulerian-rollout-exposure-r1-0715/transport-model.json --evaluation-manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --out-dir /private/tmp/kaminos-phase-appearance-transport-evaluation-physical-exposure-r2-0715 --batch-size 4096
```

Witness command:

```sh
node boundary-splat-appearance-transport-witness.mjs --evaluation /private/tmp/kaminos-phase-appearance-transport-evaluation-physical-exposure-r2-0715/destination-state-evaluation.json --out-dir /private/tmp/kaminos-phase-appearance-transport-witness-r2-0715 --width 300 --height 240
```

The hardened replay at `383d8e5a` independently byte-checked the complete 16-feature candidate payload and each ordered three-float world position across all five matched roles before rendering. It completed all 63 pairs. Its beauty and debug video hashes are byte-identical to the visually inspected predecessor; only the witness receipt hash changed because its absolute output paths changed from `r1` to `r2`.

## Claim Boundary

This establishes a causal bottleneck on one held-out basin: when support, destination positions, the exact 16-feature candidate contract, model capacity, and the nine-channel appearance model are held fixed, exact correspondence produces lower one-step state error than learned local displacement on every pair. It does not establish analytical-raymarch image error, unsupported-birth synthesis, multi-basin generalization, recurrent stability, runtime integration, or product acceptance. The isolated splat raster has not located every visually valid basin. The next product-shaped experiment is a 60 Hz alternating stream with exact analytical anchors at 30 Hz and one learned midpoint between them, evaluated against hidden exact odd-frame targets plus sample-and-hold and interpolation controls.
