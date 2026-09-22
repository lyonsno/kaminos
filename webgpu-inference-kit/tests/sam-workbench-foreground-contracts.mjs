import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { createSamWorkbenchForeground } from '../smokes/sam-workbench-foreground.js';

globalThis.GPUBufferUsage = { UNIFORM: 64, COPY_DST: 8 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
let frame, time = 0, submitCount = 0, queueWaits = 0, destroyed = 0, failSubmit = false, notifiedFailure = null;
const listeners = {};
const context = { configure() {}, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) };
const queue = { writeBuffer() {}, copyExternalImageToTexture() {},
  submit() { if (failSubmit) throw new Error('foreground device lost'); submitCount += 1; },
  async onSubmittedWorkDone() { queueWaits += 1; },
};
const device = { queue, createShaderModule: () => ({}),
  createRenderPipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
  createBuffer: () => ({ destroy() { destroyed += 1; } }), createSampler: () => ({}),
  createTexture: () => ({ createView: () => ({}), destroy() { destroyed += 1; } }), createBindGroup: () => ({}),
  createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) }),
};
const canvas = { getContext: () => context, addEventListener(name, callback) { listeners[name] = callback; },
  removeEventListener() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ width: 100, height: 100 }),
};
const renderer = await createSamWorkbenchForeground({ device, canvas, image: { naturalWidth: 100, naturalHeight: 100 },
  onError: error => { notifiedFailure = error; },
  format: 'rgba8unorm', now: () => time++, requestFrame(callback) { frame = callback; return 1; }, cancelFrame() {}, sleep: async () => {},
});
let settled = false;
const yielding = renderer.yield({ reason: 'inference-boundary' }).then(() => { settled = true; });
await settle();
assert.equal(queueWaits, 1);
assert.equal(settled, false, 'pending foreground demand must be serviced before inference continues');
frame();
await yielding;
assert.equal(submitCount, 1);
assert.equal(renderer.evidence().demandYieldCount, 1);
await renderer.yield({});
assert.equal(submitCount, 1, 'idle boundaries must not manufacture foreground work');
listeners.wheel({ preventDefault() {}, deltaY: -100 });
frame();
assert.ok(renderer.evidence().frames[1].zoom > 1);
assert.equal(renderer.evidence().inputs?.length, 1, 'foreground evidence must retain the input received by the real handler');
assert.deepEqual(renderer.evidence().frames[1].inputIds, [renderer.evidence().inputs[0].id]);
assert.ok(renderer.evidence().inputs[0].receivedAtMs < renderer.evidence().frames[1].submittedAtMs);
assert.equal(renderer.evidence().frames.length, 2);
renderer.drawNow();
assert.equal(submitCount, 3, 'capture must synchronously submit a fresh current canvas texture');
failSubmit = true;
listeners.wheel({ preventDefault() {}, deltaY: 100 });
try { frame(); } catch {}
assert.match(notifiedFailure?.message || '', /foreground device lost/,
  'idle input failure must notify the controller before another inference boundary');
await assert.rejects(() => renderer.yield({}), /foreground device lost/,
  'a foreground submission failure must remain visible at the next inference boundary');
renderer.close();
assert.throws(() => renderer.drawNow(), /closed/);
assert.equal(destroyed, 2, 'renderer releases only its texture and uniform, not the shared device');
console.log('sam workbench foreground contracts passed');
