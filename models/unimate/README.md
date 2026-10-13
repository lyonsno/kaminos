# UniMate for WebGPU: text-to-motion on any skeleton

Generate skeletal animation from a text prompt with [UniMate](https://github.com/Friedrich-M/UniMate) running entirely in the browser. Give it a rigged skeleton (a robot dog, a cat, a parrot, your own creature) and a prompt such as "A cat walks forward.", and it returns a two-second, 30 fps animation for that skeleton. The text encoder, the motion transformer, the adaptive ODE sampler and the decode to joint rotations all run on the visitor's GPU through WebGPU, using the [Kaminos inference kit](../../webgpu-inference-kit/README.md).

## What it does

- **Motion for the skeleton you give it.** UniMate conditions on a skeleton's rest pose, hierarchy, joint names and graph structure. The motion is generated directly for that body, so no retargeting step is needed. Any skeleton up to UniMate's limit of 71 joints works.
- **Any prompt.** The Flan-T5-base text encoder runs in the browser, so prompts are free text.
- **The whole sampler in the browser.** The 10-layer spatio-temporal transformer (74M parameters) runs in FP32 as WGSL compute shaders. Classifier-free guidance and a Dormand–Prince (dopri5) adaptive solver integrate the flow from noise to motion.
- **Room for the application to keep rendering.** Each network evaluation is submitted as inference-kit command duties sized to measured GPU throughput. A scene on the same device keeps its frame rate during generation, and generation can be paused, resumed and stopped between duties.
- **A complete animation.** Output includes world joint positions, local joint rotations in the skeleton's own hierarchy, the root trajectory and facing, plus the model's raw motion features.
- **Something to watch while it downloads.** The model is about 740 MB (UniMate plus the text encoder). While it downloads, the page plays a gallery of clips that this port generated in the browser: a dog, a cat, the Go2 robot dog, a parrot, a horse, an eagle, a spider and a T-rex. Drag to orbit, scroll or pinch to zoom, and scrub through any clip.

## Accuracy

The port is checked against the reference PyTorch implementation:

- **Transformer.** One evaluation matches PyTorch to a relative error of about 1.5 × 10⁻⁶. Against a float64 run of the same network it is as accurate as PyTorch's own FP32 implementation. The check covers skeletons of 18, 43 and 70 joints.
- **Text encoder.** Token ids match the Python tokenizer exactly, and caption embeddings match within about 1 × 10⁻⁶.
- **Solver.** The JavaScript dopri5 reproduces `torchdiffeq` step for step, including rejected steps and dense output. When it replays the reference step sequence, the final motion matches to 6 × 10⁻⁷.
- **End to end.** A complete browser generation from the same starting noise reproduces the reference animation. The largest joint deviation is about 0.03% of body height when run as the reference's batch of two prompts, and 0.3–0.7% of body height for a single prompt.

The browser's step-size controller measures error over the skeleton's real joints only. The reference implementation pads every skeleton to 71 joints and includes the padding in its error estimate. The browser therefore reaches the same motion with about a quarter fewer network evaluations.

## Speed

A two-second clip takes about 10 seconds on an Apple M4 Max, sharing the GPU with a continuously rendering scene that stays near 60 frames per second. A typical generation needs about 90–105 network evaluations. On a busy machine generation slows down rather than the scene: the duty scheduler gives frames priority.

## Running it

UniMate's released weights are licensed for non-commercial research use (CC BY-NC 4.0) and are not distributed here. To run the demo page, pack them locally from the [official checkpoints](https://huggingface.co/Linzhan/UniMate) with a UniMate checkout on `PYTHONPATH`:

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

Then open the printed `index.html` address. Type a prompt and press Generate. The skeleton plays the motion in a loop while the scene keeps drawing. The bundle's own prompts can also replay the noise of the captured reference run, for comparison with it.

The gallery clips in `clips/` were made with `generate-clips.mjs`, which drives this page in a headless Chrome for Testing and saves each generation as a clip file. Given a list of skeleton bundles, prompts and seeds, it writes one clip per run plus a report; `clips/index.json` lists the clips the page shows, in order.

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

## Credits and licenses

UniMate is by Linzhan Mou, Jiahui Lei, Zhiyang Dou, Chenyue Cai, Chaoyue Song, Adam Finkelstein and Szymon Rusinkiewicz ([paper](https://arxiv.org/abs/2609.05415), [code](https://github.com/Friedrich-M/UniMate)). Its code is MIT-licensed and its released weights are CC BY-NC 4.0. The gallery clips are outputs of those weights; use them non-commercially. The text encoder is Google's [Flan-T5-base](https://huggingface.co/google/flan-t5-base) (Apache 2.0).
