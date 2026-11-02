// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

class Element extends EventTarget {
  value = '1'; textContent = ''; disabled = false; hidden = false; files = [];
  replaceChildren() {}
  setAttribute(key, value) { this[key] = String(value); }
  removeAttribute(key) { delete this[key]; }
}
const ids = ['upload', 'file', 'remove', 'pause', 'stop', 'status', 'error', 'elapsed', 'progress',
  'progress-label', 'operation', 'dimensions', 'load-time', 'run-time', 'image', 'zoom', 'fit',
  'download', 'image-label', 'original', 'cutout', 'compare', 'split', 'split-control'];
const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
elements.split.value = '0.5';
const source = { width: 2, height: 1, rgba: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]) };
const calls = { loads: 0, runs: [], images: [], downloads: [], destroyed: 0 };
let resolveRun, rejectRun, options;
const model = {
  device: {}, foreground: {}, model: { planned: { steps: 314 } },
  async load() { calls.loads++; options.onProgress({ phase: 'loading' }); options.onProgress({ phase: 'loaded' }); },
  removeForeground(request) { calls.runs.push(request); return new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; }); },
  async pause() { return { status: 'paused' }; }, async resume() { return { status: 'running' }; },
  stop() { rejectRun(new DOMException('Stopped', 'AbortError')); },
  async destroy() { calls.destroyed++; },
};
const window = new EventTarget();
const context = vm.createContext({ console, performance, URL, URLSearchParams, Event, EventTarget, DOMException,
  Uint8ClampedArray, setTimeout, clearTimeout, setInterval, clearInterval, window,
  document: { getElementById: id => elements[id], querySelectorAll: () => [] }, location: { search: '' },
  __create: opts => { options = opts; assert.equal(opts.load, false); return model; },
  __source: source, __calls: calls,
});
const result = await build({ entryPoints: [new URL('../models/u2net/examples/external-app/app.js', import.meta.url).pathname],
  bundle: true, write: false, format: 'iife', define: { 'import.meta.url': '"https://studio.example/dist/app.js"' }, plugins: [{ name: 'application-dependencies', setup(builder) {
    builder.onResolve({ filter: /^@kaminos\/u2net$|^lucide$|image-view\.js$|image-io\.js$|sample\.webp$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path.includes('image-view') ? 'export async function createImageView(){return {setImages(s,r){__calls.images.push({source:s,result:r})},setMode(){},setSplit(){},setBackground(){},setZoom(){},fit(){},destroy(){}}}' :
      args.path.includes('image-io') ? 'export async function readImage(input){__calls.input=input;return __source} export function downloadPng(r,n){__calls.downloads.push({r,n})}' :
      args.path.includes('sample.webp') ? 'export default "sample.webp";' :
      args.path === 'lucide' ? 'export const Download=[],Maximize=[],Square=[],Pause=[],Play=[],Upload=[];export const createElement=()=>({});' :
      'export async function createU2NetApp(opts){return __create(opts)}' }));
  } }] });
vm.runInContext(result.outputFiles[0].text, context);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const click = id => elements[id].dispatchEvent(new Event('click'));
await settle();
assert.equal(calls.loads, 0, 'opening the app does not download weights');
assert.equal(calls.runs.length, 0, 'removal is user driven');
assert.equal(calls.images.at(-1).source, source);
assert.equal(calls.input, 'https://studio.example/dist/sample.webp', 'bundled asset resolves beside the module');
click('remove'); await settle();
assert.equal(calls.runs.length, 1);
assert.equal(calls.runs[0].pixels, source.rgba);
assert.equal(elements.remove.disabled, true);
await calls.runs[0].onPhase('u2net-input');
assert.equal(elements.progress.value, undefined, 'unknown inference work remains indeterminate');
assert.equal(elements.status.textContent, 'Removing background');
click('pause'); await settle();
assert.equal(elements.status.textContent, 'Removal paused');
await calls.runs[0].onPhase('u2net-mask');
assert.equal(elements.status.textContent, 'Removal paused', 'telemetry cannot hide a control state');
click('pause'); await settle();
const cutout = { width: 2, height: 1, rgba: new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]) };
resolveRun(cutout); await settle();
assert.equal(calls.images.at(-1).result, cutout);
assert.equal(elements.download.disabled, false);
assert.equal(calls.destroyed, 0, 'keep the application usable after success');
click('download'); await settle();
assert.equal(calls.downloads[0].r, cutout);
click('remove'); await settle();
assert.equal(calls.loads, 1, 'repeat use reuses the loaded model');
rejectRun(new Error('Inference interrupted')); await settle();
assert.match(elements.error.textContent, /Inference interrupted/);
assert.equal(calls.images.at(-1).result, cutout, 'failure retains the previous usable result');
assert.equal(elements.remove.disabled, false);
click('remove'); await settle(); click('stop'); await settle();
assert.equal(elements.status.textContent, 'Removal stopped');
assert.equal(calls.images.at(-1).result, cutout);
context.__source = { width: 1, height: 1, rgba: new Uint8ClampedArray([20, 30, 40, 128]) };
elements.file.files = [{ name: 'transparent.png' }];
elements.file.dispatchEvent(new Event('change')); await settle();
assert.equal(elements.download.disabled, true, 'a new source cannot export the old cutout');
click('remove'); await settle();
assert.equal(calls.runs.length, 3, 'existing transparency bypasses the opaque-only model');
assert.equal(calls.images.at(-1).result, context.__source);
assert.equal(elements.status.textContent, 'Existing transparency retained');
window.dispatchEvent(new Event('pagehide')); await settle();
assert.equal(calls.destroyed, 1);
console.log('U2Net starter: explicit run, progress, controls, retained output, export, retry and exit passed');
