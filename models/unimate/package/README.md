# @kaminos/unimate-webgpu

Skeletal animation from a text prompt, for any rigged skeleton, running entirely in the browser on WebGPU. This is a port of [UniMate](https://github.com/Friedrich-M/UniMate) (Mou et al., 2026). The Flan-T5 text encoder, the motion transformer, the adaptive ODE sampler and the decode to joint rotations all run on the visitor's GPU, using the [Kaminos WebGPU inference kit](https://www.npmjs.com/package/@kaminos/webgpu-inference-kit).

**[Try it](https://lyonsno.github.io/kaminos/inference-kit/unimate/)** · [Source and full documentation](https://github.com/lyonsno/kaminos/tree/main/models/unimate)

- **Any skeleton.** Use one of eight published skeletons (a dog, cat, horse, T-rex, spider, eagle, parrot, or the Go2 robot dog), or bring your own rigged `.glb`. The skeleton is prepared in the browser the way UniMate's own preprocessing prepares it.
- **Your mesh, animated.** A rig's skinned mesh is bound to the generated skeleton. The result exports as an animated `.glb`, ready for Blender or any glTF tool.
- **Shares the GPU.** Each network evaluation runs as GPU duties sized to measured throughput, so your scene keeps rendering while a clip generates, and a run can be paused or stopped.
- **Faithful.** One evaluation matches the PyTorch reference to a relative error of about 10⁻⁶, and a whole generation reproduces the reference animation.

## Install

```sh
npm install @kaminos/unimate-webgpu
```

The package is plain ES modules with no build step. Use it from a bundler or straight from a browser with an import map.

## Generate motion

```js
import { createUniMateGenerator, requestUniMateDevice, HUB } from '@kaminos/unimate-webgpu';
import { createWebGpuInferenceSession, createWebGpuForegroundService } from '@kaminos/webgpu-inference-kit/core';

const device = await requestUniMateDevice(await navigator.gpu.requestAdapter());
const session = await createWebGpuInferenceSession({ sessionId: 'my-app', device, adapterName: 'browser' });
const foreground = createWebGpuForegroundService({ routeId: 'my-app', device });

const unimate = await createUniMateGenerator({
  device, session, beginRun: (id, options) => foreground.beginRun(id, options),
  weightsBase: `${HUB}/unimate-fp16/`, t5Base: `${HUB}/t5-fp16/`, bundleBase: `${HUB}/skeletons/dog/`,
  onBytes: (loaded, total) => console.log(`${loaded} of ${total} bytes`),
});
const { motion } = await unimate.generate({ text: 'A dog runs forward.', seed: 1 });
// motion.positions: world joint positions [frames x joints x 3] at 30 fps;
// motion.localRotations: per-joint local rotations (w, x, y, z); motion.rootTranslation.
```

Your render loop keeps drawing during a generation by submitting its frames through the same foreground service, with `foreground.request({ requestId, run(opportunity) { opportunity.submit([commandBuffer]); } })`. The model's duties then interleave with your frames.

## Animate your own rig

```js
import { createUniMateConsumer } from '@kaminos/unimate-webgpu';

const host = { device, session, beginRun: (id, options) => foreground.beginRun(id, options) };
const consumer = createUniMateConsumer(host);
const bytes = await (await fetch('/models/fox.glb')).arrayBuffer();
const { glb, motion, rig } = await consumer.run({ asset: { bytes, name: 'fox' }, prompt: 'An object walks forward.', seed: 1 });
// glb: an animated .glb holding your skinned mesh, materials and textures bound to the
// generated skeleton. Play it in any glTF viewer (three.js: AnimationMixer), or save it.
```

`consumer.read()` reports progress: the stage (`download`, `label`, `encode`, `solve`, `bake`), byte counts while the model downloads, and evaluations while it solves. `consumer.stop()` stops a run between GPU duties.

To prepare the rig yourself, call the steps directly:

1. `readRig(bytes)` reads the skeleton the way UniMate's Blender import and export do.
2. `await (await createLabeler()).label(rig)` runs UniMate's own rule-based joint labeller (Python via Pyodide, loaded on first use) for joint labels and the facing direction. It runs in a web worker so your page keeps drawing. Vite, webpack and Parcel bundle the worker; if your bundler leaves `unimate-rig-labels-worker.js` out, the labeller runs on the page instead and says so in its status.
3. `buildSkeletonBundle(rig, labels, ...)` builds the model's conditioning and the bound mesh.
4. `exportMotionGlb(...)` writes the result.

Each step is exported, so you can review or edit labels in between, as upstream recommends. A rest pose authored upside down or lying down can be stood up with `turnRest(rig, 'x180')`, the same turns as UniMate's `--rest_rotation`.

## Generate after editing proportions

For an editor that already has a prepared bundle `{ b, a }`, refresh its rest positions while keeping the exact joint names, ordering and parent graph:

```js
import { reconditionSkeletonBundle } from '@kaminos/unimate-webgpu';

const skeletonData = reconditionSkeletonBundle(sourceBundle, {
  jointNames, parents, positions: editedJointHeads, name: 'Edited cat',
});
const { glb, motion, skeleton, restFrame } = await consumer.run({
  asset: { skeletonData }, prompt: 'A cat walks forward.', seed: 1,
});
```

Heads are XYZ arrays in the editor's local Y-up frame, facing +Z by default; pass `facing: { forward: [x, y, z] }` for another heading. Object placement stays in the editor. Geometry conditioning is rebuilt; source label embeddings and the spectral basis are retained. Changed names, ordering or topology require preparing a new bundle through `buildSkeletonBundle`. The helper produces skeleton-only conditioning: attaching or rebinding an existing skin remains the host's job.

The consumer accepts the same `{ b, a, mesh? }` prepared data as the generator. A cold start uses it directly; subsequent runs reuse the loaded model. Supply one input kind: prepared data, a rigged GLB, or a stock skeleton. The generated motion and GLB use UniMate's canonical frame. `restFrame` retains the canonical transform (`yaw`, `scale`, `offset`, and column-vector `rotation`) for the host's return to the authoring frame; it does not apply that transform to playback automatically. Old captured prompts, noise, reference motions and binary digests are omitted from the refreshed bundle. Retain your source identity and the edited input alongside the generated clip when saving it.

## Requirements

- **Browser:** WebGPU. Tested in Chrome on Apple Silicon.
- **Download:** about 370 MB on first use, kept in the browser's Cache API afterwards. The weights are stored at half precision and widened to float32 on the GPU.
- **GPU memory:** about 1 GB while loaded.
- **Speed:** on an Apple M4 Max, a two-second clip takes about 10 seconds for an 18-joint skeleton and about 30 seconds for a 50-joint one.

## Licenses

- **This package** is MIT-licensed, and so is the UniMate code it ports.
- **The model weights are not part of this package.** By default they load from [BasinShapers/unimate-webgpu](https://huggingface.co/BasinShapers/unimate-webgpu). UniMate's released weights are under **CC BY-NC 4.0, non-commercial use only**; check that this fits your use. Flan-T5-base is under Apache 2.0.

UniMate is by Linzhan Mou, Jiahui Lei, Zhiyang Dou, Chenyue Cai, Chaoyue Song, Adam Finkelstein and Szymon Rusinkiewicz: [paper](https://arxiv.org/abs/2609.05415), [code](https://github.com/Friedrich-M/UniMate), [project page](https://linzhanmou.com/unimate/).
