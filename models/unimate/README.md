# UniMate for WebGPU: text-to-motion on any skeleton

Generate skeletal animation from a text prompt with [UniMate](https://github.com/Friedrich-M/UniMate) running entirely in the browser. Give it a rigged skeleton (a robot dog, a cat, a parrot, your own creature) and a prompt such as "A cat walks forward.", and it returns a two-second, 30 fps animation for that skeleton. The text encoder, the motion transformer, the adaptive ODE sampler and the decode to joint rotations all run on the visitor's GPU through WebGPU, using the [Kaminos inference kit](../../webgpu-inference-kit/README.md).

**[Try it in your browser](https://lyonsno.github.io/kaminos/inference-kit/unimate/)** · Weights: [BasinShapers/unimate-webgpu](https://huggingface.co/BasinShapers/unimate-webgpu)

## What it does

- **Motion for the skeleton you give it.** UniMate conditions on a skeleton's rest pose, hierarchy, joint names and graph structure. The motion is generated directly for that body, so no retargeting step is needed. Any skeleton up to UniMate's limit of 71 joints works.
- **Any prompt.** The Flan-T5-base text encoder runs in the browser, so prompts are free text.
- **The whole sampler in the browser.** The 10-layer spatio-temporal transformer (74M parameters) runs in FP32 as WGSL compute shaders. Classifier-free guidance and a Dormand–Prince (dopri5) adaptive solver integrate the flow from noise to motion.
- **Room for the application to keep rendering.** Each network evaluation is submitted as inference-kit command duties sized to measured GPU throughput. A scene on the same device keeps its frame rate during generation, and generation can be paused, resumed and stopped between duties.
- **A complete animation.** Output includes world joint positions, local joint rotations in the skeleton's own hierarchy, the root trajectory and facing, plus the model's raw motion features.
- **Your own rig, skin and all.** Choose "Your own rig (.glb)…" or drop a rigged .glb on the page. The page prepares the skeleton the way UniMate's own preprocessing does and generates for it. It plays your skinned mesh, with its textures, driven by the generated motion. You can review the joint labels and the facing pair and apply changes.
- **Downloads.** Every animation generated in the page downloads as an animated .glb. For your own rig, the file holds your mesh bound to the skeleton, ready for Blender or any glTF tool.
- **Eight bodies to animate.** The published page offers the Go2 robot dog and seven Truebones animals: cat, dog, horse, T-rex, spider, eagle and parrot. Switching body takes a moment; the model stays loaded.
- **Something to watch while it downloads.** The model is about 370 MB (UniMate plus the text encoder), downloaded once and then kept in the browser's cache. While it downloads, the page plays a gallery of clips that this port generated in the browser: a dog, a cat, the Go2 robot dog, a parrot, a horse, an eagle, a spider and a T-rex. Drag to orbit, scroll or pinch to zoom, and scrub through any clip.

## Accuracy

The port is checked against the reference PyTorch implementation:

- **Transformer.** One evaluation matches PyTorch to a relative error of about 1.5 × 10⁻⁶. Against a float64 run of the same network it is as accurate as PyTorch's own FP32 implementation. The check covers skeletons of 18, 43 and 70 joints.
- **Text encoder.** Token ids match the Python tokenizer exactly, and caption embeddings match within about 1 × 10⁻⁶.
- **Solver.** The JavaScript dopri5 reproduces `torchdiffeq` step for step, including rejected steps and dense output. When it replays the reference step sequence, the final motion matches to 6 × 10⁻⁷.
- **End to end.** A complete browser generation from the same starting noise reproduces the reference animation. The largest joint deviation is about 0.03% of body height when run as the reference's batch of two prompts, and 0.3–0.7% of body height for a single prompt.

The browser's step-size controller measures error over the skeleton's real joints only. The reference implementation pads every skeleton to 71 joints and includes the padding in its error estimate. The browser therefore reaches the same motion with about a quarter fewer network evaluations.

## Download size

The published page loads both models with float16 storage, which halves the download to about 370 MB. `pack-half.py` writes these copies. Biases, norms and other small tensors stay float32. At load, [`unimate-weights.js`](unimate-weights.js) widens every weight back to float32, so the kernels and their arithmetic are unchanged; only the stored values are rounded.

The effect on the motion is negligible:

- **One network evaluation:** about 2–4 × 10⁻⁴ relative error against PyTorch, against 1.5 × 10⁻⁶ with float32 weights.
- **Text encoder:** caption embeddings within about 3.5 × 10⁻⁴.
- **Go2 reference clips:** a whole generation takes the same adaptive steps and lands as close to the accepted CPU clips as the float32 run: 2.9 × 10⁻³ against 3.0 × 10⁻³, and 4.5 × 10⁻⁴ against 4.2 × 10⁻⁴.
- **Gallery clips:** the dog and cat clips regenerate within 0.07% of body size.

`?precision=fp32` loads the float32 copies.

## Speed

On an Apple M4 Max a two-second clip takes about 10 seconds for the 18-joint Go2 and about 30 seconds for the 51-joint dog, sharing the GPU with a continuously rendering scene that stays near 60 frames per second. Time grows with the number of joints; a typical generation needs about 90–130 network evaluations. On a busy machine generation slows down rather than the scene: the duty scheduler gives frames priority.

## Running it

The [published page](https://lyonsno.github.io/kaminos/inference-kit/unimate/) loads the packed weights and skeletons from [BasinShapers/unimate-webgpu](https://huggingface.co/BasinShapers/unimate-webgpu) on Hugging Face. UniMate's weights are licensed for non-commercial use (CC BY-NC 4.0), so they live there with their license rather than in this repository.

To run the page from your own copy, pack the weights from the [official checkpoints](https://huggingface.co/Linzhan/UniMate) with a UniMate checkout on `PYTHONPATH`:

```sh
python pack-weights.py --unimate-root <UniMate> --exp-dir <experiment dir> \
  --model-path <checkpoint_step_150000.pt> --out weights/unimate
python pack-t5.py --t5-dir <google/flan-t5-base snapshot> --out weights/t5
```

A skeleton is prepared once with UniMate's own preprocessing. Use its [`rig_preprocess`](https://github.com/Friedrich-M/UniMate) output for a custom GLB, glTF or FBX rig, or a skeleton from its datasets. Then bundle it for the page:

```sh
python export-reference.py --mode forward --unimate-root <UniMate> --exp-dir <experiment dir> \
  --model-path <checkpoint> --asset <asset dir or skeleton name> [--cond-path <cond.npy>] \
  --prompt "A cat walks forward." --seed 10 --out capture/cat
python export-demo-bundle.py --capture capture/cat --asset-cond <cond.npy> [--asset-key Cat] \
  --exp-dir <experiment dir> --out bundles/cat
node serve-unimate.mjs --weights weights/unimate --bundle bundles/cat --t5 weights/t5
```

Then open the printed `index.html` address. A page on `localhost` or `127.0.0.1` loads from the local server; add `?weights=hub` to load the published copies instead. Type a prompt and press Generate. The skeleton plays the motion in a loop while the scene keeps drawing. The bundle's own prompts can also replay the noise of the captured reference run, for comparison with it.

The gallery clips in `clips/` were made with `generate-clips.mjs`, which drives this page in a headless Chrome for Testing and saves each generation as a clip file. Given a list of skeleton bundles, prompts and seeds, it writes one clip per run plus a report; `clips/index.json` lists the clips the page shows, in order.

## Bring your own rig

The page prepares a rigged .glb the way UniMate's [`rig_preprocess`](https://github.com/Friedrich-M/UniMate) does for an unanimated asset, entirely in the browser:

1. **Skeleton** ([`unimate-rig-glb.js`](unimate-rig-glb.js)). It reads the skin's joints, the nodes between them and the armature, and the rest pose, following Blender's glTF import (bind pose from the inverse bind matrices where Blender takes it). It then prunes helper bones as UniMate's export does.
2. **Joint labels and facing** ([`unimate-rig-labels.js`](unimate-rig-labels.js)). UniMate's own offline rule labeller, unchanged, runs in [Pyodide](https://pyodide.org) (Python in WebAssembly), loaded on first use. `pack-labeler.py` builds its bundle from a UniMate checkout.
3. **Conditioning** ([`unimate-rig-features.js`](unimate-rig-features.js)). It computes:
   - the canonical rest pose (facing +Z, centred, scaled to tree diameter 2, grounded);
   - joint depths, pairwise relations and graph distances;
   - the Laplacian spectral features;
   - the normalized rest-pose features.

   The page's own T5 encoder embeds the labels.

Upstream recommends reviewing the labels and facing pair before generating, and the page lets you edit both. The tests check the importer against UniMate's own preprocessing:

- **Skeleton features:** on the eight published skeletons, `tests/rig-features-contracts.mjs` reproduces the exported model inputs.
- **Import and labels:** on four Khronos sample rigs and a custom creature, `tests/rig-import-contracts.mjs` reproduces upstream's exported joints, rest pose, joint order, canonical pose, topology and spectral features. The fixtures come from UniMate's pipeline run in Blender (`tests/export-rig-fixtures.py`). The labeller's labels and facing pairs are identical to upstream's.
- **Model inputs:** on the creature, the conditioning the page builds matches the inputs PyTorch fed the model to within 3 × 10⁻⁷.

One known difference: where the graph Laplacian has a repeated eigenvalue, the basis of that eigenspace is arbitrary. The page's eigensolver picks a different basis than NumPy's, and NumPy's pick is not reproducible across machines either.

Only the rest pose is used. An animated .glb is treated like an unanimated one, so UniMate's motion-based pruning of animated assets is not applied.

### Your mesh and downloads

[`unimate-rig-mesh.js`](unimate-rig-mesh.js) binds the rig's skinned mesh to the skeleton UniMate animates. It works the way `rig_preprocess` bakes an asset into the model's canonical frame (facing +Z, centred, scale, grounded):

- Each vertex is placed through its own skin joints at the imported rest pose.
- A pruned joint's weight moves to the joint that absorbed it.
- Each vertex keeps its eight strongest influences.

The page then skins the mesh on the GPU, with linear blend skinning from the generated joint transforms.

[`unimate-export-glb.js`](unimate-export-glb.js) writes the download. It holds the joint hierarchy at the canonical rest pose and animation tracks for every joint's rotation and the root's travel at 30 fps. For your own rig it also holds the bound mesh, its skin, and its materials and textures. Gallery clips store only joint positions, so they download as JSON.

The checks:

- `tests/export-glb-contracts.mjs` reads a written file back and replays its animation against the motion.
- The Khronos glTF validator reports no errors on files from the Fox, CesiumMan and a Kaminos cat asset.
- Blender plays them back with every joint within 10⁻⁶ of where the page put it.
- Rendered at rest in Blender, the bound cat mesh looks the same as UniMate's own canonical bake of the asset.

## Using it in an application

- [`CooperativeUniMateDenoiser`](unimate-cooperative.js) is the network. `configure({ B, J })` allocates it for a batch and skeleton size. `writeConditioning(...)` and `encodePrepare(...)` set up a skeleton and caption once. Each evaluation is then encoded as command duties through a duty scheduler.
- [`createCooperativeCfgDrift`](unimate-cooperative.js) is the classifier-free-guided velocity, and [`dopri5Solve`](unimate-dopri5.js) integrates it from noise to motion.
- [`decodeUniMateMotion`](unimate-decode.js) turns the motion features into joint positions, local rotations and the root trajectory.
- [`T5Encoder`](unimate-t5.js) encodes a prompt into UniMate's caption embedding.
- [`createUniMateDemo`](unimate-demo.js) shows the complete wiring: an inference session on a shared device, a foreground service for the scene, a kit route per generation, and pause, resume and stop through the inference control.

## Checking the port

The `tests/` contract tests run in Node without a GPU:

- the solver against `torchdiffeq`;
- the decode against UniMate's;
- the tokenizer against the Python tokenizer.

The browser witnesses compare against reference captures from the PyTorch implementation:

- `run-forward-witness.mjs`: one network evaluation, stage by stage, with negative and depth-clamp controls.
- `run-solver-witness.mjs`: the solver along the reference trajectory, a replay of its steps, and a free run.
- `run-t5-witness.mjs`: the text encoder.
- `run-demo-witness.mjs`: the demo page, driven the way a person uses it.
- `run-gallery-witness.mjs`: the clip gallery, captured while the model downloads and at chosen frames of every clip.
- `run-rig-witness.mjs`: imports a rigged .glb through the page and can apply reviewed labels or a rest turn. It writes the conditioning the page built, generates on the rig, and saves the download with the joint positions it should play.
- `run-site-witness.mjs`: the published page as assembled for GitHub Pages, with weights from Hugging Face: first load, generation on two skeletons, and a reload from the browser cache.

## Credits and licenses

UniMate is by Linzhan Mou, Jiahui Lei, Zhiyang Dou, Chenyue Cai, Chaoyue Song, Adam Finkelstein and Szymon Rusinkiewicz ([paper](https://arxiv.org/abs/2609.05415), [code](https://github.com/Friedrich-M/UniMate)). Its code is MIT-licensed and its released weights are CC BY-NC 4.0. The gallery clips are outputs of those weights; use them non-commercially. The text encoder is Google's [Flan-T5-base](https://huggingface.co/google/flan-t5-base) (Apache 2.0).
