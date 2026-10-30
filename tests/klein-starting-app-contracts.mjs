// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

class Element extends EventTarget {
  value = ''; textContent = ''; disabled = false;
  replaceChildren() {}
}
const elements = Object.fromEntries(['prompt-form', 'prompt', 'seed', 'steps', 'size', 'generate',
  'stop', 'status', 'error', 'image', 'zoom', 'fit', 'download', 'image-label']
  .map(id => [id, new Element()]));
Object.assign(elements.prompt, { value: 'A red bicycle beside a lake' });
elements.seed.value = '17'; elements.steps.value = '3'; elements.size.value = '512';
const calls = { load: 0, runs: [], destroyed: 0, images: [] };
let resolveRun, rejectRun;
const model = {
  device: {}, foreground: {},
  async load() { calls.load++; },
  generate(options) { calls.runs.push(options); return new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; }); },
  async destroy() { calls.destroyed++; }, stop() {},
};
const window = new EventTarget();
const context = vm.createContext({ console, performance, URLSearchParams, Event, EventTarget, setTimeout,
  document: { getElementById: id => elements[id], querySelectorAll: () => [] }, window,
  location: { search: '' },
  __model: model, __images: calls.images,
});
const result = await build({ entryPoints: [new URL('../models/flux2-klein/examples/external-app/app.js', import.meta.url).pathname],
  bundle: true, write: false, format: 'iife', plugins: [{ name: 'application-dependencies', setup(builder) {
    builder.onResolve({ filter: /^@kaminos\/flux2-klein$|^lucide$|image-view\.js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path.includes('image-view') ? 'export async function createImageView(){return {setImage(i){globalThis.__images.push(i)},fit(){},setZoom(){},destroy(){}}}' :
      args.path === 'lucide' ? 'export const Download=[],Maximize=[],Square=[];export const createElement=()=>({});' :
      'export async function createKleinApp(){return globalThis.__model;}' }));
  } }] });
vm.runInContext(result.outputFiles[0].text, context);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
await settle();
assert.equal(calls.load, 0, 'opening the application must not start a weight download');
assert.equal(calls.runs.length, 0, 'generation belongs to the user, not page startup');

const submit = () => elements['prompt-form'].dispatchEvent(new Event('submit', { cancelable: true }));
submit(); await settle();
assert.equal(calls.runs.length, 1);
assert.equal(calls.runs[0].prompt, elements.prompt.value);
assert.equal(calls.runs[0].seed, 17);
assert.equal(elements.generate.disabled, true);
const image = { width: 512, height: 512, rgba: new Uint8ClampedArray(512 * 512 * 4) };
resolveRun(image); await settle();
assert.equal(calls.images.at(-1), image);
assert.equal(calls.destroyed, 0, 'a finished image must leave the app usable');
assert.equal(elements.generate.disabled, false);

elements.prompt.value = 'A green bicycle beside a lake';
submit(); await settle();
assert.equal(calls.runs.length, 2);
assert.equal(calls.runs[1].prompt, elements.prompt.value);
rejectRun(new Error('Download interrupted')); await settle();
assert.match(elements.error.textContent, /Download interrupted/);
assert.equal(elements.generate.disabled, false, 'failure must allow another attempt');
assert.equal(calls.images.at(-1), image, 'a failed request must retain the previous image');
submit(); await settle();
resolveRun(image); await settle();
assert.equal(calls.runs.length, 3);
assert.equal(calls.destroyed, 0);
window.dispatchEvent(new Event('pagehide')); await settle();
assert.equal(calls.destroyed, 1, 'release belongs to application exit, not a scripted test ending');
console.log('Klein starting application: user-driven runs, repeat use, failure/retry and exit passed');
