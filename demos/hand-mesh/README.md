# Live hand mesh

A focused camera demo for Kaminos WebGPU Inference Kit. WiLoR hand detection and MobRecon reconstruction run on the visitor's GPU. The camera image stays in the browser. The mesh shows articulation and shape, not calibrated world placement.

Serve the repository with `python3 serve.py 8501`, then open `http://127.0.0.1:8501/demos/hand-mesh/`. The static Pages builder places the same demo at `/inference-kit/hand-mesh/`. A WebGPU-capable browser, a secure origin (HTTPS or localhost), and camera permission are required.

## Model setup

The first version imports model files once and saves them in this browser's IndexedDB. Later visits restore those files without another download or file selection. Browser storage is specific to this origin and profile; clearing site data removes it. Private browsing or storage quotas may prevent saving; the current visit still works.

This local import path is provisional. An automatic public model download has not been authorized for the MANO-derived package. The demo does not upload model files or camera frames, contact an inference server, or proxy restricted assets through another host.

Prepare the two packages using the existing model packers and your own source/assets:

```sh
python models/mobrecon/pack-weights.py --help
python models/wilor-hand-detector/pack-weights.py --help
```

MobRecon's packer needs the pinned HandMesh source at `3c87e958d4855f890e3884ec94bcfc0f99422c3d`, its DenseStack+SpiralConv checkpoint and `template/transform.pkl`. The detector packer needs the WiLoR-MLX hand detector weights. The packers' imports require the corresponding source environments (PyTorch/OpenCV/OpenMesh for MobRecon, MLX for the detector). These are preparation dependencies, not browser runtime dependencies. See [HandMesh setup](https://github.com/SeanChenxy/HandMesh) and [WiLoR-MLX](https://github.com/lyonsno/wilor-mlx). Follow the applicable asset terms; public source availability is not redistribution permission.

Once both package directories exist, this lightweight command verifies their hashes and copies four files into one new folder. It performs no inference or download:

```sh
node demos/hand-mesh/prepare-local-models.mjs \
  --mobrecon /path/to/mobrecon/package \
  --detector /path/to/detector/package \
  --out /path/to/hand-models
```

Click **Choose model folder** and select that folder. The browser verifies the complete bundle hashes through the inference kit before accepting the models. Failed imports do not replace an already loaded model or stored package. Click **Start camera**. The camera can be stopped and restarted without reloading models.

## Detection

Automatic mode reconstructs only when the detector accepts a hand. On a miss it hides the mesh, shows **No hand detected**, and skips MobRecon. It continues hand detection so the hand can return. The confidence slider raises or lowers the acceptance threshold; 0.80 is an adjustable starting point, not a calibrated presence guarantee. Strong detector false positives can still produce an incorrect hand. Hand choice controls the model's reflection; the detector's class is not silently applied.

The original Workbench experiment retains explicit diagnostic manual fallback and its accepted settings. The route exposes `acquisition.onMiss: 'skip' | 'manual'`; its legacy default remains `manual` for compatibility. Public demo and Workbench therefore make different, explicit miss-policy choices while sharing model kernels.

## Source and assets

MobRecon is [SeanChenxy/HandMesh](https://github.com/SeanChenxy/HandMesh); hand detection follows WiLoR-MLX's YOLOv8m-pose route. The local MobRecon package includes MANO-derived spiral neighbourhoods, upsampling data and triangle topology needed during reconstruction. [MANO's terms](https://mano.is.tue.mpg.de/license.html) apply separately. The original detector and training/checkpoint terms also need to be respected. No model binaries, MANO files, user camera recordings or local package manifests enter the assembled public site.

The viewer and both networks share a WebGPU device. Inference currently submits whole model passes directly; the standalone demo does not claim cooperative duty scheduling or validated coexistence with heavier fluid/rendering loads.
