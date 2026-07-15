# Phase checkpoint frontier R1

## Research context

This artifact asks whether the late recurrent collapse lies behind a disconnected
checkpoint basin or along the learned direction from the accepted generation-two
destination-state model to the protected-online model. It linearly interpolates
the exact deployed `116 -> 128 -> 25` checkpoint schema at alpha `0.25`, `0.50`,
and `0.75`, then evaluates every arm on the same held-out basin in two roles:

- **One-step state:** all 63 adjacent held-out pairs, 3,059,367 uncapped samples,
  exact target support, measured against carried-current-state reuse.
- **Protected recurrence:** 63 steps with the same frozen transport model and
  exact candidate/splat support, measured by cohort state error, retained energy,
  and first persistent loss.

This artifact contains no images or videos. The predeclared gate required an
interpolant to gain energy in every aggregate and late cohort, avoid worsening
late transported/birth state error, and avoid earlier persistent hard-cohort
loss. No interpolant passed, so rendering would have converted a failed numerical
candidate into an unearned visual witness.

## Result

| Arm | One-step all | One-step transported | One-step birth | Late transported state / energy | Late birth state / energy | Persistent transported / birth loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Generation two | 0.614147 | 0.751732 | 0.772299 | 1.014349 / 0.197553 | 1.041520 / 0.203544 | 58 / 58 |
| Alpha 0.25 | 0.613520 | 0.750538 | 0.770398 | 1.015282 / 0.201285 | 1.042909 / 0.207526 | 58 / 58 |
| Alpha 0.50 | **0.613395** | **0.750067** | 0.769235 | 1.019704 / 0.205315 | 1.047726 / 0.211844 | 58 / 58 |
| Alpha 0.75 | 0.613827 | 0.750363 | **0.768833** | 1.027560 / 0.209620 | 1.055972 / 0.216454 | 58 / 45 |
| Online | 0.614933 | 0.751548 | 0.769307 | 1.039077 / 0.214203 | 1.067816 / 0.221358 | 53 / 45 |

Lower state ratios are better; higher retained-energy values are better. Every
interpolant improves one-step aggregate, transported, birth, and stable-Q3 state
relative to generation two. In recurrence, retained energy rises while aligned
hard-cohort state error worsens smoothly toward the online model. Alpha 0.75 also
makes persistent birth loss arrive at step 45 instead of step 58.

**Disposition:** the checkpoints occupy a connected weight-space tradeoff, not a
hidden Pareto crossing. Current-model exposure learned useful local corrections
on valid one-step states and a harmful closed-loop response on model-exposed
states. Stop checkpoint tuning. The next falsifier is protected-online training
with a frozen generation-two response anchor evaluated on those same exposed
inputs.

## Identity and routes

- Corpus: `/private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json`
- Corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Generation-two model SHA-256: `5eeb7e8563d59d59d7c8b69e4360634d7931db3399e993a36a27eb27f783f267`
- Online model SHA-256: `64098ba1e5282b384d5c325a356e4a9446248762471fa3c59974007517c4bd8c`
- Interpolant SHA-256: alpha 0.25 `acdb1a0910cbf96ba3b46eed69197f0458befc71d959409b125dc4ce9b3d6189`; alpha 0.50 `5512e3647afde87266134231260006ac0370927f0abb5c06191eaef97c78f7e2`; alpha 0.75 `04b4b5afbbe1b767842840097e48d61f32ecd01a70a7199c8f9d363ec1edc5e8`
- Construction: CPython `3.12.12`, host CPU, deterministic linear interpolation, 34,713 parameters per arm, no fallback.
- Evaluation: MLX `Device(gpu, 0)`, `/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python`, batch 4096, null fallback.
- Recurrence jobs: `f520872634ee`, `41cdaf6df5d1`, `c2c782885ccf`.
- One-step jobs: `239402d12ebe`, `071a8ffd7d48`, `4675784514b9`.

Each `*-greenroom.json` receipt records requested parameters, the exact effective
command, timestamps, terminal exit `0`, and failure state. Each evaluation report
records effective MLX backend/device/fallback identity. `frontier-comparison.json`
verifies candidate-frame hash agreement across every recurrent arm and reproduces
the preserved endpoint metrics within `1e-12`.

## Commands

Checkpoint construction:

```sh
python3 boundary-splat-phase-state-interpolate.py \
  --from-model artifacts/pyro-phase-rollout-generation-two-r1-0715/receipts/gen2-model.json \
  --to-model artifacts/pyro-phase-online-rollout-r1-0715/receipts/online-model.json \
  --out-dir /private/tmp/kaminos-phase-checkpoint-interpolation-r1-0715 \
  --alpha 0.25 --alpha 0.50 --alpha 0.75
```

The exact six Greenroom execution commands are preserved as `effective_route` in
the corresponding `receipts/*-greenroom.json` files. Their submission contract was:

```sh
gpu-greenroom submit kaminos_phase_transport_protected_splat_mlx_infer \
  /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json OUT \
  --cwd /private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713 \
  -p model=/private/tmp/kaminos-phase-transport-eulerian-full-r1-0714/transport-model.json \
     state_model=INTERPOLANT inference_start=0 inference_steps=63 grid_size=160 batch_size=4096

gpu-greenroom submit kaminos_phase_destination_state_mlx_evaluate \
  /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json OUT \
  --cwd /private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713 \
  -p model=INTERPOLANT batch_size=4096
```

Focused interpolation verification:

```sh
/private/tmp/kaminos-pyro-phase-audit-venv-0714/bin/python -m unittest \
  tests.test_boundary_splat_phase_state_interpolate \
  tests.test_boundary_splat_phase_state_residual_mlx \
  tests.test_boundary_splat_phase_state_evaluate_mlx \
  tests.test_boundary_splat_phase_transport_mlx
```

## Artifact map

- `frontier-comparison.json`: normalized one-step and recurrent comparison, gate,
  route identity, and claim boundary.
- `models/`: exact three interpolated deployed-schema checkpoints.
- `receipts/*-one-step-report.json`: complete all-pair metrics and pair records.
- `receipts/*-recurrence-audit.json`: aggregate, late, and persistent-loss cohorts.
- `receipts/*-recurrence-predictions.json`: 63-step protected prediction manifests.
- `receipts/*-greenroom.json`: terminal Greenroom execution authority.
- `receipts/interpolation-report.json`: source compatibility, construction route,
  stale-output cleanup, parameter counts, and hashes.
- `review/summary.txt`: bounded GPT-5.5 review/revision/confirmation account.
- `SHA256SUMS`: hashes for every payload file in this artifact.

## Claim boundary

This is one held-out basin with exact protected support, one fixed transport
model, three linear weight-space interpolants, 63 uncapped one-step pairs, and 63
protected recurrent steps. It establishes objective mismatch along this checkpoint
direction. It does not establish rendered appearance, analytical-raymarch agreement,
the success of response anchoring, multi-basin generalization, runtime uptake, or
product acceptance.
