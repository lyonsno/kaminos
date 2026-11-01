// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createWebGpuInferenceControl } from '../webgpu-inference-kit/src/inference-control.js';

class Element extends EventTarget {
  value = ''; textContent = ''; disabled = false; hidden = false;
  replaceChildren() {}
  removeAttribute(name) { if (name === 'value') this.value = null; }
}
const elements = Object.fromEntries(['prompt-form', 'prompt', 'seed', 'steps', 'size', 'generate',
  'pause', 'stop', 'status', 'error', 'image', 'zoom', 'fit', 'download', 'image-label',
  'progress-area', 'progress', 'progress-label', 'elapsed', 'runtime', 'time-loading', 'time-generation',
  'time-text', 'time-denoise', 'time-decode', 'time-weights', 'time-reference', 'transfer',
  'load-part', 'load-file', 'operation', 'queue-time', 'work']
  .map(id => [id, new Element()]));
Object.assign(elements.prompt, { value: 'A red bicycle beside a lake' });
elements.seed.value = '17'; elements.steps.value = '3'; elements.size.value = '512';
const calls = { load: 0, runs: [], destroyed: 0, images: [] };
let resolveRun, rejectRun, resolveLoad, resolvePause, appOptions, loaded = false, now = 0;
const timers = new Map(); let timerId = 0;
const model = {
  device: {}, foreground: {},
  load() { calls.load++; return new Promise(resolve => { resolveLoad = () => { loaded = true; resolve(); }; }); },
  generate(options) { calls.runs.push(options); return new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; }); },
  async destroy() { calls.destroyed++; }, stop() {},
  pause() { return new Promise(resolve => { resolvePause = resolve; }); }, async resume() { return { status: 'running' }; },
  snapshot() { return { loaded }; },
};
const window = new EventTarget();
const context = vm.createContext({ console, performance: { now: () => now }, URLSearchParams, Event, EventTarget, setTimeout,
  setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id),
  document: { getElementById: id => elements[id], querySelectorAll: () => [] }, window,
  location: { search: '' },
  __model: model, __images: calls.images, __options: options => { appOptions = options; },
});
const result = await build({ entryPoints: [new URL('../models/flux2-klein/examples/external-app/app.js', import.meta.url).pathname],
  bundle: true, write: false, format: 'iife', plugins: [{ name: 'application-dependencies', setup(builder) {
    builder.onResolve({ filter: /^@kaminos\/flux2-klein$|^lucide$|image-view\.js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path.includes('image-view') ? 'export async function createImageView(){return {setImage(i){globalThis.__images.push(i)},fit(){},setZoom(){},destroy(){}}}' :
      args.path === 'lucide' ? 'export const Download=[],Maximize=[],Square=[],Pause=[],Play=[];export const createElement=()=>({});' :
      'export async function createKleinApp(options){globalThis.__options(options);return globalThis.__model;}' }));
  } }] });
vm.runInContext(result.outputFiles[0].text, context);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
await settle();
assert.equal(calls.load, 0, 'opening the application must not start a weight download');
assert.equal(calls.runs.length, 0, 'generation belongs to the user, not page startup');

const submit = () => elements['prompt-form'].dispatchEvent(new Event('submit', { cancelable: true }));
submit(); await settle();
appOptions.onProgress('transformer', 'weights-0.bin', { loadedBytes: 25, totalBytes: 100 });
assert.equal(elements.progress.value, .25, 'weight progress must use the loader aggregate, not a fabricated run percentage');
assert.equal(elements['progress-label'].textContent, 'Model weight bytes');
appOptions.onProgress('transformer', 'weights-1.bin', { loadedBytes: 30 });
assert.equal(elements.progress.value, null, 'unknown totals must clear the previous denominator');
now = 2500; for (const fn of timers.values()) fn();
assert.equal(elements.elapsed.textContent, '2.5 s elapsed');
resolveLoad(); await settle();
assert.equal(calls.runs.length, 1);
assert.equal(calls.runs[0].prompt, elements.prompt.value);
assert.equal(calls.runs[0].seed, 17);
assert.equal(elements.generate.disabled, true);
assert.equal(elements.progress.value, null, 'waiting for admission has no invented percentage');
calls.runs[0].onPhase('text');
assert.equal(elements.status.textContent, 'Encoding prompt');
now = 3500; calls.runs[0].onPhase('denoise');
calls.runs[0].onStep(1, 3);
assert.equal(elements.progress.value, 1 / 3);
assert.equal(elements['progress-label'].textContent, 'Sampling step 1 of 3');
calls.runs[0].scheduling.onDuty({ label: 'transformer.block.0', queueMs: 8, estimatedFlops: 2e9 });
assert.equal(elements.operation.textContent, 'transformer.block.0');
assert.equal(elements['queue-time'].textContent, '8.0 ms');
elements.pause.dispatchEvent(new Event('click')); await settle();
const control = createWebGpuInferenceControl({ queue: { onSubmittedWorkDone: async () => {} } });
resolvePause(await control.pause()); await settle();
assert.equal(elements.status.textContent, 'Generation paused', 'Klein pause returns the control snapshot, not UniMate toggle text');
assert.equal(elements.pause.ariaLabel, 'Resume generation');
elements.pause.dispatchEvent(new Event('click')); await settle();
assert.equal(elements.status.textContent, 'Generating image');
await control.resume(); await control.close();
now = 6000; calls.runs[0].onStep(3, 3); calls.runs[0].onPhase('decode');
assert.equal(elements.progress.value, null, 'finishing sampling is not image completion');
assert.equal(elements.status.textContent, 'Decoding image');
const image = { width: 512, height: 512, rgba: new Uint8ClampedArray(512 * 512 * 4) };
now = 7500;
resolveRun(image); await settle();
assert.equal(calls.images.at(-1), image);
assert.equal(calls.destroyed, 0, 'a finished image must leave the app usable');
assert.equal(elements.generate.disabled, false);
assert.equal(elements.status.textContent, 'Image complete');
assert.equal(elements.progress.value, 1);
assert.equal(elements['time-loading'].textContent, '2.5 s');
assert.equal(elements['time-generation'].textContent, '5.0 s');
assert.equal(elements['time-text'].textContent, '1.0 s');
assert.equal(timers.size, 0, 'terminal progress must not leave a timer running');

elements.prompt.value = 'A green bicycle beside a lake';
submit(); await settle();
assert.equal(elements.operation.textContent, '--', 'repeat requests must clear previous telemetry');
assert.equal(elements['time-loading'].textContent, 'Already loaded');
resolveLoad(); await settle();
assert.equal(calls.runs.length, 2);
assert.equal(calls.runs[1].prompt, elements.prompt.value);
rejectRun(new Error('Download interrupted')); await settle();
assert.match(elements.error.textContent, /Download interrupted/);
assert.equal(elements.generate.disabled, false, 'failure must allow another attempt');
assert.equal(calls.images.at(-1), image, 'a failed request must retain the previous image');
assert.equal(timers.size, 0);
assert.equal(elements.progress.hidden, true, 'failed work must not look active');
submit(); await settle();
resolveLoad(); await settle();
elements.pause.dispatchEvent(new Event('click')); await settle();
assert.equal(elements.status.textContent, 'Pausing generation');
calls.runs[2].onPhase('decode');
assert.equal(elements.status.textContent, 'Pausing generation', 'telemetry must not overwrite control state');
elements.stop.dispatchEvent(new Event('click'));
resolvePause({ status: 'paused' }); await settle();
assert.equal(elements.status.textContent, 'Stopping generation', 'a late pause must not replace Stop');
rejectRun(Object.assign(new Error('stopped'), { name: 'AbortError' })); await settle();
assert.equal(elements.status.textContent, 'Stopped');
assert.equal(timers.size, 0);
submit(); await settle(); resolveLoad(); await settle();
resolveRun(image); await settle();
assert.equal(calls.runs.length, 4);
assert.equal(calls.destroyed, 0);
window.dispatchEvent(new Event('pagehide')); await settle();
assert.equal(calls.destroyed, 1, 'release belongs to application exit, not a scripted test ending');
console.log('Klein starting application: user-driven runs, repeat use, failure/retry and exit passed');
