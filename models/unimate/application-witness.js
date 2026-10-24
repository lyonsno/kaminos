// Outside-package consumer witness. The renderer is the existing UniMate demo scene;
// inference uses createUniMateConsumer, sharing that renderer's device and kit host.
import { createUniMateConsumer } from '@kaminos/unimate-webgpu';
import { createUniMateDemo } from '@kaminos/unimate-webgpu/demo';
import { bundleArrays } from '@kaminos/unimate-webgpu/unimate-generator.js';

const state = window.unimateApplication = { phase: 'starting', runs: [], progress: [], partials: [], gpuErrors: [] };
const status = document.querySelector('#status');
const fail = error => { state.phase = 'failed'; state.error = String(error.stack ?? error); status.textContent = state.error; };
const plain = value => JSON.parse(JSON.stringify(value, (_key, v) => ArrayBuffer.isView(v) ? Array.from(v) : v));
try {
  const demo = window.unimateRenderer = await createUniMateDemo({ canvas: document.querySelector('canvas') });
  demo.device.addEventListener('uncapturederror', event => state.gpuErrors.push(event.error.message));
  const consumer = window.unimateConsumer = createUniMateConsumer({ device: demo.device, session: demo.session,
    beginRun: (id, options) => demo.foreground.beginRun(id, options) }, {
    weightsBase: '/weights/', t5Base: '/t5/', skeletonsBase: '/skeletons/', defaultSkeleton: 'go2',
  });
  const index = await (await fetch('/skeletons/go2/demo.json')).json();
  const arrays = bundleArrays(index, await (await fetch('/skeletons/go2/demo.bin')).arrayBuffer());
  document.querySelector('#prompt').value = index.prompts[0].text;
  state.input = { skeleton: index.skeleton.name, joints: index.skeleton.joints, frames: index.skeleton.frames, prompt: index.prompts[0].text };
  const reference = arrays[index.prompts[0].referencePositions];
  demo.showClip({ skeleton: index.skeleton, positions: reference, frames: index.skeleton.frames, fps: index.skeleton.fps });
  state.display = 'captured reference clip'; status.textContent = 'Captured reference clip. Generate to replace it.';
  state.phase = 'idle';
  window.runUniMateApplication = async () => {
    state.phase = 'running'; state.error = null;
    const framesBefore = demo.scene.frames;
    try {
      const result = await consumer.run({ asset: { skeleton: 'go2' }, prompt: document.querySelector('#prompt').value,
        seed: Number(document.querySelector('#seed').value), onProgress: progress => {
          state.progress.push(plain(progress));
          status.textContent = `Generating: ${progress.stage ?? progress.phase}. Showing ${state.display}.`;
        }, onPartial: sample => state.partials.push(plain(sample)) });
      window.unimateOutput = result;
      state.runs.push({ ...plain(result.report), framesDuring: demo.scene.frames - framesBefore,
        frames: result.motion.frames, joints: result.motion.joints, skeleton: result.skeleton.name,
        glbBytes: result.glb.byteLength, positions: Array.from(result.motion.positions) });
      demo.showClip({ skeleton: result.skeleton, positions: result.motion.positions, frames: result.motion.frames, fps: result.skeleton.fps });
      state.display = 'generated animation'; state.phase = 'done'; status.textContent = 'Generated animation — drag to orbit.';
      return result;
    } catch (error) {
      state.phase = error.name === 'AbortError' ? 'stopped' : 'failed';
      state.error = String(error.message ?? error); status.textContent = `${state.phase}: ${state.error}`;
      throw error;
    }
  };
  document.querySelector('#generate').onclick = () => window.runUniMateApplication().catch(() => {});
  document.querySelector('#pause').onclick = () => consumer.togglePause();
  document.querySelector('#stop').onclick = () => consumer.stop();
} catch (error) { fail(error); }
