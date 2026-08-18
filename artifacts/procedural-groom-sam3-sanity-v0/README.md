# SAM3 Literal-Prompt Sanity Diagnosis

Question: Why did the procedural-groom SAM3 return appear to contain many scattered small segments when ordinary SAM behavior is normally a few large, legible masks?

Result: ordinary text-only SAM3 behavior is polite on the frozen cat image. The prior spray was manufactured by the wrapper contract: it lowered the score threshold from the documented image default `0.3` to `0.1`, called the raw predictor without the normal helper's NMS, unioned every surviving query, and passed Gemma's broad locality box as a positive geometry prompt. The same `Dense, rounded fur` phrase returns nine raw text-only candidates at `0.1` but one coherent coat candidate at `0.3 + NMS 0.5`; with the broad box it returns twenty-six raw candidates and retains a spurious exterior halo even after default threshold and NMS.

The direct prompt `long fur on the lower half of the cat head` returns one visibly localized lower-coat/ruff mask under the documented default. This is encouraging front-view prompt evidence, not multiview admission.

## Route

- Repo: Kaminos
- Runtime worktree: normalized as `{repoRoot}` in public evidence; exact volatile coordinates remain in Greenroom job receipt `05e5e9ccd831`.
- Source implementation commit: `af7290e9`
- Greenroom job type: `kaminos_procedural_groom_sam3_sanity`
- Greenroom job: `05e5e9ccd831`, terminal `done`, exit code `0`
- Portable command: `gpu-greenroom submit kaminos_procedural_groom_sam3_sanity artifacts/procedural-groom-sam3-sanity-v0/request-front-constitutive.json artifacts/procedural-groom-sam3-sanity-v0/run-front-constitutive`
- Model/checkpoint: `mlx-community/sam3-bf16`, snapshot `dfe573c3171dbcfda8399c650d9135afa7e94592`
- Backend/device: MLX Metal, `Device(gpu, 0)`
- Source: constitutive-ruff procedural cat, front view, SHA-256 `5a7fc0e64d20ed2c55ceddd6417af98641121eaa3cd8e8b9ae78973490117f2d`
- Controls: raw threshold `0.1`; report thresholds `0.1`, `0.3`, and `0.5`; NMS IoU `0.5`; ten literal prompts; no Gemma inference in this job.

## Evidence

- `request-front-constitutive.json`: source, literal prompt matrix, thresholds, route request, and claim ceiling.
- `run-front-constitutive/report.json`: terminal route identity, every raw candidate's score/box/mask digest, and each derived selection view.
- `run-front-constitutive/visual-inspection.json`: agent visual inspection and causal disposition for the decision-bearing views.
- `review-front-constitutive.html`: single consolidated operator page with the decisive comparison grid, every selection view, and the six highest-scoring individual candidates per prompt.
- `run-front-constitutive/selection-views/gemma-main-fur-box-guided/raw-0p1-overlay.png`: observed bad output; twenty-six candidates union into a large exterior field.
- `run-front-constitutive/selection-views/gemma-main-fur-text-only/default-0p3-nms-0p5-overlay.png`: corrected invocation comparison; one coherent coat candidate.
- `run-front-constitutive/selection-views/whole-cat/default-0p3-nms-0p5-overlay.png`: known-normal whole-object behavior.
- `run-front-constitutive/selection-views/cat-nose/default-0p3-nms-0p5-overlay.png`: known-normal small-part behavior.
- `run-front-constitutive/selection-views/lower-long-fur/default-0p3-nms-0p5-overlay.png`: direct long-fur prompt result.
- `run-front-constitutive/selection-views/negative-car/default-0p3-nms-0p5-overlay.png`: negative control with zero candidates.

Does not prove: arbitrary-image SAM3 quality, multiview consistency, VLM prompt-proposal quality, anatomical correctness, production semantic regions, hidden-carrier reconstruction, or groom admission. The broad-box result diagnoses this predictor API and wrapper use; it does not establish that every SAM interface treats boxes identically.
