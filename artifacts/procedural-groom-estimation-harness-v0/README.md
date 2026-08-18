# Procedural Groom Estimation Harness v0

This surface makes the paired subtle-versus-constitutive ruff assay resumable without recovering paths or commands from earlier evidence sheets. `assay-config.json` is the run authority for arm inputs, output roots, exact Gemma and SAM identities, threshold, truth root, controlled constants, and claim ceiling. `tools/procedural-groom-estimation-assay.py` materializes digest-bound observations, records exact registered commands, identifies the next lawful phase, and runs the two local phases.

## One-time path

From the Kaminos repository root:

```sh
python3 tools/procedural-groom-estimation-assay.py \
  --config artifacts/procedural-groom-estimation-harness-v0/assay-config.json \
  prepare subtle-density12x

python3 tools/procedural-groom-estimation-assay.py \
  --config artifacts/procedural-groom-estimation-harness-v0/assay-config.json \
  commands subtle-density12x

python3 tools/procedural-groom-estimation-assay.py \
  --config artifacts/procedural-groom-estimation-harness-v0/assay-config.json \
  next subtle-density12x
```

Run the emitted `vlmSubmit` command once through GPU Greenroom. After its registered terminal event, run `next` again. If it returns `seal_proposal`, execute:

```sh
python3 tools/procedural-groom-estimation-assay.py \
  --config artifacts/procedural-groom-estimation-harness-v0/assay-config.json \
  seal subtle-density12x
```

Run the emitted `samSubmit` once only when `next` reports `submit_sam`. After SAM's registered terminal event, run the local comparison:

```sh
python3 tools/procedural-groom-estimation-assay.py \
  --config artifacts/procedural-groom-estimation-harness-v0/assay-config.json \
  compare subtle-density12x
```

Repeat with arm `constitutive-ruff2p5x`. The second arm is intentionally unavailable until its source-like observation exists and matches the configured observation id; `prepare` fails loud before creating model evidence if it is missing or stale.

## State and failure semantics

Each arm writes `observation.json`, `run-manifest.json`, `vlm-raw/`, `sam3-raw/`, and `comparison.json` under its configured output root. The manifest binds the config, source observation, prompt, requested models/backends, truth root, portable command templates, and claim ceiling. The `commands` action resolves those templates against the caller's current repository root; private worktree coordinates are runtime state and do not belong in committed evidence. `next` stops on terminal VLM/SAM failure rather than advancing a partial run. Proposal sealing rejects unnormalized, degenerate, truth-exposed, reordered, or digest-drifted VLM output before SAM. The prompt deliberately requests bounding boxes as `[x_min, y_min, x_max, y_max]` arrays; sealing preserves the raw model inventory and emits a separately digest-bound `normalized-inventory.json` with named coordinates for SAM. Structural normalization carries no semantic or geometric admission.

Gemma 3 4B is the cheap first model arm, not the campaign authority. Its failure is not evidence that the semantic decomposition technique fails and does not justify changing the method before several more capable VLMs are tested.
