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

The package is plain ES modules with no build step. Use it from a bundler or straight from a browser with an import map. For the shared application lifecycle below, build the kit and UniMate from the same checkout using the [source-package recipe](https://github.com/lyonsno/kaminos/blob/main/webgpu-inference-kit/docs/model-applications.md#install-the-source-packages). These source additions do not imply a new npm release.

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

`consumer.read()` reports the stage (`download`, `label`, `encode`, `solve`, `bake`), byte counts while the model downloads, and solver progress. `acceptedT` tracks accepted solver time separately from attempted evaluations and rejected steps. The returned report retains solver steps and evaluations.

Reuse the consumer for sequential calls. An overlapping call rejects. `await consumer.togglePause()` switches an admitted cooperative run between `paused` and `running`, returning `null` before its control is available. `consumer.stop()` cancels queued work without taking another model's renderer and stops admitted work at its next cooperative boundary. Prompt encoding settles before cancellation returns. Stopping during the initial load prevents generation after that load completes.

Call `await consumer.destroy()` when finished. It stops and awaits pending work, releases model buffers and closes its labelling worker. The host's device, session and foreground service remain yours. A destroyed consumer rejects further runs.

The generator uses the kit's shared application runner for admission, controls and settlement. Its `generate`, `encodeText`, `togglePause`, `stop` and `destroy` operations share that lifetime; `snapshot()` exposes it and `running` includes queued work. Each generator has a distinct runtime `routeId` by default; callers may supply one explicitly. Switch skeletons between runs. `cooperative: false` retains admission and cleanup but has no pause or mid-model cancellation contract.

Both `consumer.run()` and `generator.generate()` accept `rtol`, `atol`, `cfgScale` and `onPartial(sample)`. Defaults remain `1e-3`, `1e-6` and `3`. Partial callbacks receive decoded motion at the bundle's requested solver output times; the consumer includes `restFrame` for prepared input. These are intermediate estimates, and the final return still contains the complete animation. Use the exported denoiser, solver and decoding steps directly when your host already owns its admitted model invocation.

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
