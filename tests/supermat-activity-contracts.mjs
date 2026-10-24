// kaminos-test: node
// Execute the actual outside app with a controlled clock and submission boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source = await fs.readFile(new URL('../models/supermat/examples/external-app/app.js', import.meta.url), 'utf8');
let now = 0, pending, finish, inference;
const raf = [], writes = [], submissions = [];
const context = { configure() {}, getCurrentTexture: () => ({ createView() {} }) };
const elements = Object.fromEntries(['scene', 'frame-gap', 'status', 'run', 'file', 'size', 'pause', 'stop', 'destroy', 'input', 'albedo', 'roughness', 'metallic'].map(id => [id, { width: 1024, height: 96, value: '512', files: [{}], textContent: '', getContext: () => id === 'scene' ? context : { putImageData() {} } }]));
const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
const app = { device: { addEventListener() {}, createBuffer: () => ({}), createShaderModule: () => ({}),
  createRenderPipelineAsync: async () => ({ getBindGroupLayout() {} }), createBindGroup: () => ({}),
  queue: { writeBuffer(_b, _o, data) { writes.push([...data]); } },
  createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }) },
  foreground: { request(request) { pending = request; return { completion: new Promise(r => { finish = r; }) }; } },
  infer: () => new Promise((_r, reject) => { inference = reject; }), destroy: async () => {} };
const sandbox = { window: {}, document: { getElementById: id => elements[id] }, location: { search: '' }, URLSearchParams,
  performance: { now: () => now }, requestAnimationFrame: callback => raf.push(callback),
  navigator: { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } }, GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8 },
  createSuperMatApp: async () => app, decodeImageRgba: async () => ({ width: 1, height: 1, data: [0, 0, 0, 255] }),
  ImageData: class {}, console };
await vm.runInNewContext(`(async()=>{${source.replace(/^import .*;\n/, '')}})()`, sandbox);
const state = sandbox.window.supermatExample;
assert.equal(state.status, 'idle', state.error);
async function frame(requestedAt, submittedAt, receiptAt, submitError = false) {
  now = requestedAt; assert.ok(raf.length); raf.shift()(requestedAt);
  now = submittedAt;
  try { pending.run({ submit(commands) { if (submitError) throw Error('submit failed'); submissions.push({ now, commands }); } }); }
  catch (error) { assert.ok(submitError); }
  now = receiptAt; finish({ status: submitError ? 'failed-before-submission' : 'completed' }); await Promise.resolve();
}
await frame(10, 20, 80);
await frame(90, 120, 170);
assert.ok(state.frameTiming, 'the live indicator must expose observed submission gaps instead of hiding cadence in a color pulse');
assert.equal(state.frameTiming.lastGapMs, 100, 'measure submission spacing, not rAF or receipt spacing');
assert.equal(state.frameTiming.longestGapMs, 100);
await frame(180, 520, 530);
assert.equal(state.frameTiming.lastGapMs, 400);
await frame(540, 550, 560);
assert.equal(state.frameTiming.lastGapMs, 30);
assert.equal(state.frameTiming.longestGapMs, 400, 'a later fast frame must not erase the hitch');
assert.match(elements['frame-gap'].textContent, /400\.0/);
assert.ok(writes.length >= 4, 'marker positions must be submitted to the GPU');
assert.ok(Math.abs(writes[2][0] - 520 / 1500) < 1e-6, 'motion must sample time at the actual opportunity, not the stale rAF request');
await elements.file.onchange();
const running = elements.run.onclick();
assert.equal(state.frameTiming.longestGapMs, null, 'new inference starts its own observation');
inference(Object.assign(Error('stop'), { name: 'AbortError' })); await running;
await frame(570, 580, 590);
await frame(600, 640, 660);
assert.equal(state.frameTiming.lastGapMs, 60);
assert.equal(state.frameTiming.longestGapMs, 60);
await frame(670, 900, 950, true);
assert.equal(state.frameTiming.longestGapMs, 60, 'a failed submission cannot become a successful draw observation');
assert.equal(state.frames, 6);
assert.equal(raf.length, 0, 'failure must not manufacture ongoing successful frames');
console.log('Outside-app marker follows submission time and preserves unsmoothed gaps without counting failed submissions');
