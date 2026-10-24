# Live hand mesh

A focused camera demo for Kaminos WebGPU Inference Kit. WiLoR hand detection and MobRecon reconstruction run on the visitor's GPU. The camera image stays in the browser. The mesh shows articulation and shape, not calibrated world placement.

Serve the repository with `python3 serve.py 8501`, then open `http://127.0.0.1:8501/demos/hand-mesh/`. The static Pages builder places the same demo at `/inference-kit/hand-mesh/`. A WebGPU-capable browser, a secure origin (HTTPS or localhost), and camera permission are required.

## Model setup

On macOS or Linux, paste this command into Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/lyonsno/kaminos/main/demos/hand-mesh/setup.sh | bash
```

The command installs a private Python runner if needed, downloads the pinned demo code and original model assets, verifies their SHA-256 hashes, prepares both browser packages, starts a local server and opens the demo. Review the linked model terms and type `yes` on first use. Then click **Start camera** and allow camera access. Keep the terminal open; Ctrl-C stops the server. Run the same command next time: it reuses verified model files.

No Git checkout, Node, PyTorch, MLX, OpenMesh build or manual model-folder selection is needed. Preparation uses NumPy, SciPy and safetensors; browser inference uses WebGPU. The first run downloads about 156 MB of model inputs, plus the demo and Python dependencies. Model inputs and prepared packages remain on this computer under `~/.local/share/kaminos/hand-demo`. The command does not upload camera frames or models. Windows users can use the existing prepared-folder import; this shell launcher has no native Windows claim.

The command pins its runtime code by commit. The MANO-derived data and original model terms still apply; acceptance does not grant commercial or redistribution rights. Original assets download directly from the authors' published routes, rather than a Kaminos model mirror.

For a different installation folder, set `KAMINOS_HAND_HOME` on the `bash` side of the pipeline. For example, append `KAMINOS_HAND_HOME="$HOME/hand-demo" bash` in place of `bash`. For unattended preparation after reviewing terms, use `bash -s -- --accept-model-terms --prepare-only`. `--no-open` suppresses opening the browser, and `--port PORT` chooses a loopback port. Reruns preserve completed downloads and write progress or failure details to `setup-state.json`; early bootstrap failures write `bootstrap-error.txt`.

### Existing packages

You can still use **Use existing model folder** with `mobrecon.package.json`, `mobrecon.bin`, `detector.package.json` and `hand-detector.bin`. The browser verifies bundle hashes and saves accepted file imports in IndexedDB for this origin/profile. Clearing site data removes that browser cache. A failed import does not replace an already working model. The local-server launcher loads directly from disk and needs no IndexedDB copy.

Existing packer outputs can be assembled with:

```sh
node demos/hand-mesh/prepare-local-models.mjs --mobrecon /path/to/mobrecon/package --detector /path/to/detector/package --out /path/to/hand-models
```

## Detection

Automatic mode reconstructs only when the detector accepts a hand. On a miss it hides the mesh, shows **No hand detected**, and skips MobRecon. It continues hand detection so the hand can return. The confidence slider raises or lowers the acceptance threshold; 0.80 is an adjustable starting point, not a calibrated presence guarantee. Strong detector false positives can still produce an incorrect hand. Hand choice controls the model's reflection; the detector's class is not silently applied.

The original Workbench experiment retains explicit diagnostic manual fallback and its accepted settings. The route exposes `acquisition.onMiss: 'skip' | 'manual'`; its legacy default remains `manual` for compatibility. Public demo and Workbench therefore make different, explicit miss-policy choices while sharing model kernels.

## Source and assets

MobRecon is [SeanChenxy/HandMesh](https://github.com/SeanChenxy/HandMesh); hand detection follows WiLoR-MLX's YOLOv8m-pose route. The local MobRecon package includes MANO-derived spiral neighbourhoods, upsampling data and triangle topology needed during reconstruction. [MANO's terms](https://mano.is.tue.mpg.de/license.html) apply separately. The original detector and training/checkpoint terms also need to be respected. No model binaries, MANO files, user camera recordings or local package manifests enter the assembled public site.

The viewer and both networks share a WebGPU device. The demo consumes [the hand application API](../../models/mobrecon/GETTING_STARTED.md), which owns model loading, admission and safe retirement. Control and foreground opportunities exist before detection and reconstruction; each network pass remains indivisible. Separate models sharing a session run in sequence, so this does not establish responsive tracking alongside a long image generation or heavier fluid/rendering loads.
