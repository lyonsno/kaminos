# TRELLIS official fine-fur route discriminator

Question: Does the official TRELLIS fine-fur demo source produce materially healthier fine-clump geometry through TRELLIS-Mac/MPS than through the current TRELLIS-MLX route, and is the MLX failure repaired by raising its requested face target?

Result: Raising the MLX target from 200,000 to 1,000,000 faces does not materially change the observed triangular-flake failure. The dense MPS decode does materially improve the cloak exterior from disconnected flakes to a continuous directional striated surface. It still does not reproduce the source's clean overlapping tufts, and the attached figure and cloak underside remain severely malformed. The MPS result is therefore a useful route discriminator, not a successful fine-fur reconstruction.

## Route

- Repo/worktree: Kaminos, `/private/tmp/kaminos-molten-triradial-proposals-0808`, branch `cc/molten-triradial-proposals-0808`.
- Source: `source/official-dwarf-fur-cloak.webp`, SHA-256 `933c10aeebb2920b08cb34a08ab1878817b64eb9e30efdcc3d76731069fc0849`.
- MLX controls: `trellis2mlx_fast`, 512 resolution, six steps, seed 80301, texture 1024, with 200,000 and 1,000,000 requested target faces. The route receipts and exact effective geometry counts are in `result.json` and `higher-face-result.json`.
- MPS-requested control: unpinned `microsoft/TRELLIS.2-4B` weights through a dirty TRELLIS-Mac checkout at commit `d58628f4f5b9c3de8274cb110074154f4b31cef2`, requested MPS device, CPU fallback permitted, Torch 2.12.1, 512 pipeline, six steps, seed 80301, SDPA attention, and `flex_gemm` sparse convolution. The retained GLB contains vertices and faces only; whether the pipeline internally entered texture work was not instrumented.
- MPS command: `/Users/noahlyons/dev/trellis-mac/.venv/bin/python -u run_mps_geometry_control.py --source <absolute-source> --output-dir <absolute-output-dir> --trellis-root /Users/noahlyons/dev/trellis-mac --seed 80301 --pipeline-type 512 --steps 6 --target-faces 500000`.
- Dense inspection: Blender 5.1.2, Cycles CPU, eight samples, 640 by 640, orthographic. `render_dense_glb_cpu.py` imported and rendered the 27,134,294-face GLB directly.

## Images

- `source/official-dwarf-fur-cloak.webp`: official source and visual target.
- `output/orbit/az120-el12.png`: ordinary MLX route; observed triangular-flake failure.
- `higher-face-output/orbit/az120-el12.png`: higher requested MLX face target; no material improvement.
- `mps-geometry-output/dense-render-az120-el12.png`: nominally matched azimuth/elevation view of the dense MPS decode, rendered with a separate clay material, lighting rig, and framing contract. It supports qualitative inspection, not controlled per-pixel route comparison.
- `mps-geometry-output/dense-render-exterior.png`: clearest MPS exterior-surface diagnostic.
- `index.html`: operator-facing adjacent comparison with route interpretation.

## Authority correction

The pre-correction MPS runner recorded transport completion after exporting a GLB even though topology-preserving QEM reduced 29,784,342 raw faces only to 27,134,294 faces rather than the requested 500,000. Its raw `run-report.json` also contains an unobserved `textureOrUvStageEntered: false` field; the adjudicated result does not rely on that field. `mps-result.json` lowers the semantic result to `partial`, and the corrected runner returns nonzero while preserving the dense output whenever the target is missed. The 382,914,708-byte dense GLB is retained only in the local worktree because it is too large for this repository; its SHA-256 is `de991bc18b4b3a689de25dcde24665058960b7b4877079c7e3c28c58a5047d2d`. The committed images preserve the visual observation, but the package does not provide durable independent replay of the raw MPS geometry.

Does not prove: that official CUDA TRELLIS would fail this source; that MPS cannot produce cleaner fur under another decode or postprocess route; that the current dense surface is production-usable; that the run stayed entirely on MPS; that texture work was skipped internally; or that the MLX failure originates in only one stage. The durable observations support two narrower conclusions: target-face pressure did not repair the current MLX route in these two runs, and the MPS-requested run's committed diagnostic renders show materially more directional exterior organization on this exact source and seed.
