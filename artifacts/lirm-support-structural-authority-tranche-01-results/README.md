# Lerm Support Structural Authority Tranche 01

Question: With one FLUX seed, prompt, renderer, and matched clay/depth/normal body package held fixed, can a fourth support-control image materially change locomotor structure while preserving a friendly Lerm identity?

Result: Yes. All three outputs remain happy, safe, connected, eyeless, nose-led, toy-like Lerms with stable red/cream/orange region semantics. The zero-signal control produces a four-support quadruped. The continuous latent underside field produces a low compressed body with two large integrated support masses and unresolved grounding. The explicit role-plane produces a clean upright two-support morphology with planted feet. No literal carrier colors or marks leak into any output.

This is evidence that a separate support-control carrier can exert structural authority over generator interpretation without requiring support geometry to enter the body SDF. It also exposes a useful distinction: continuous latent fields influence mass and compression, while explicit role peaks more directly induce discrete supports.

## Route

- repo: `/Users/noahlyons/dev/kaminos`
- worktree: `/private/tmp/kaminos-molten-projected-support-legibility-r2-0725`
- branch: `cc/molten-projected-support-legibility-r2-0725`
- pre-run head: `2649992efe2e62e4c62edb5423d0f1153fd9d47c`
- requested route: `gpu-greenroom/mflux_flux2_edit_promptfile_4ref`
- effective runner: `/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit`
- Greenroom worker source: `/private/tmp/gpu-greenroom-handy-durable-command-0725@8ac87f5af0c42f8ff329f7d4b98198cd30d03cd3`
- model: `flux2-klein-9b`, quantization `q4`
- backend/device: local MFLUX/MLX route serialized by GPU Greenroom; the receipt does not separately emit a Metal device identifier
- controls: seed `727001`, `512x512`, `8` steps, guidance `1.0`, MLX cache limit `48 GiB`
- reference order: clay, depth, normal, support-control
- prompt: [`../lirm-support-structural-authority-tranche-01/prompt.txt`](../lirm-support-structural-authority-tranche-01/prompt.txt)
- run window: `2026-07-27T21:09:45-0400` through `2026-07-27T21:24:28-0400`

The exact argv, params, timestamps, worker identity, stdout, and stderr are preserved under each cell. `completion.json` is the accepted route/input/output validation receipt.

## Images

- [`contact-sheet.png`](contact-sheet.png): top row contains the three accepted FLUX outputs; bottom row contains their exact fourth-reference support controls.
- [`cell-a/output.png`](cell-a/output.png): zero-support control; generator-prior quadruped.
- [`cell-b/output.png`](cell-b/output.png): latent continuous underside; low integrated support masses with unresolved grounding.
- [`cell-c/output.png`](cell-c/output.png): explicit role-plane; upright two-support morphology.
- [`../lirm-support-structural-authority-tranche-01/cells/`](../lirm-support-structural-authority-tranche-01/cells/): matched clay, depth, normal, and support-control source images.

## Visual Admission

The decomposed ledgers in [`classifications/`](classifications/) positively classify every output for safety, happiness, Lerm identity, region coherence, connected body, and head-tail polarity, with literal carrier leakage absent. [`exposure-filtered-comparison.json`](exposure-filtered-comparison.json) records that all three cells are eligible for operator inspection.

## Rejected Attempts

Jobs `f813daf11932` and `7286ab31c8aa` returned exit code `0` after receiving cwd-relative prompt/reference paths. Their stdout says `Prompt file does not exist`, and neither produced `output.png`. They are preserved under [`rejected-attempts/`](rejected-attempts/) as false-success evidence. The accepted B/C jobs use absolute paths.

## Does Not Prove

This tranche does not prove multi-seed reliability, multi-view identity consistency, exact four-role recovery, 3D support topology after TRELLIS, riggability, contact stability, or locomotion quality. Cell B is visually coherent while floating, so support influence and terrain-grounded support remain separate claims.
