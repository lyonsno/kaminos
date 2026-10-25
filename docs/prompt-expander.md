# Local BFL prompt helper

`prompt-expander.html` lets you try BFL's Qwen3.5-9B prompt upsampler with text and up to ten reference images. The expanded text is editable and copyable; use it with the same references in Generate. Recent runs retain their original inputs and output. The browser is the interface; inference uses MLX on the local Mac through GPU Greenroom.

Install `mlx-vlm==0.7.8` into a separate Python environment and obtain `mlx-community/flux-3-image-klein-pup-4bit` (tested conversion revision `34abfa0769000d6a542169b0e61a04059697467c`). Reuse an existing download where possible. A caller-owned JSON configuration names the actual local paths:

```json
{
  "model_dir": "/absolute/path/to/flux-3-image-klein-pup-4bit",
  "model_repo": "mlx-community/flux-3-image-klein-pup-4bit",
  "model_revision": "34abfa0769000d6a542169b0e61a04059697467c",
  "python": "/absolute/path/to/venv/bin/python",
  "greenroom_bin": "/absolute/path/to/gpu-greenroom",
  "queue_dir": "/absolute/path/to/the/serviced/queue",
  "state_dir": "/absolute/path/to/retained/prompt-runs"
}
```

Start `serve.py` with `KAMINOS_BIND_HOST=127.0.0.1` and `KAMINOS_PROMPT_EXPANDER_CONFIG=/absolute/path/to/config.json`, then visit `/prompt-expander.html`. A worker must service the configured queue. Each request submits one structured command and exits after generation, releasing its model memory. Queue wait, model load, and generation are separate. No model download or alternate-model fallback happens during a request.

The same HTTP API accepts `POST /api/prompt-expander/runs` with `{"prompt":"…","images":[{"name":"reference.png","data":"base64 bytes"}]}`. Poll `GET /api/prompt-expander/runs/<id>`. The retained request, command manifest, queue submission, effective input, prepared references, caption and report live under `<state_dir>/<id>/`. The inference CLI also accepts explicit `--request` and `--report` paths; run heavy commands through Greenroom.

The implementation follows [BFL's published helper](https://github.com/black-forest-labs/flux-3-image-klein/blob/main/src/flux3/pup.py): shipped system prompts, image order, RGB-over-white/EXIF handling, reference-dependent size budgets, JPEG quality 92, thinking disabled, greedy generation, and generated-token-only presence penalty for text-to-image. The 3,584-token output limit and ten-reference limit come from that harness. Reaching the output limit is reported as partial. This first page supports its ordinary text-to-image and image-edit tasks; bounding-box annotation tasks are not exposed.

The four-bit MLX conversion is distinct from BFL's original BF16/vLLM execution. Local use does not establish numerical equivalence or browser execution. The helper model's license and the image generator's license are separate; see their published model cards.
