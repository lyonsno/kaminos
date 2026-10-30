// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

class Element extends EventTarget {
  value = ''; textContent = ''; disabled = false; dataset = {}; files = [];
  replaceChildren() {}
  setAttribute(name, value) { this[name] = value; }
  getContext() { return { configure() {}, putImageData() {} }; }
}
const elements = {};
const $ = id => elements[id] ??= new Element();
$('size').value = '512'; $('zoom').value = '1';
const tabs = ['input', 'albedo', 'roughness', 'metallic'].map(name => {
  const tab = $(`tab-${name}`); tab.dataset.map = name; return tab;
});
const calls = { load: 0, runs: [], images: [], destroyed: 0, animation: [], pause: 0, resume: 0, stop: 0 };
const image = { width: 2, height: 2, data: new Uint8Array(16).fill(127) };
let resolveRun, rejectRun;
const model = {
  device: { addEventListener() {}, createBuffer() {}, createShaderModule() {}, createBindGroup() {},
    async createRenderPipelineAsync() { return { getBindGroupLayout() {} }; } }, foreground: {},
  async load() { calls.load++; },
  infer(options) { calls.runs.push(options); return new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; }); },
  async pause() { calls.pause++; }, async resume() { calls.resume++; }, async stop() { calls.stop++; },
  async destroy() { calls.destroyed++; },
};
const window = new EventTarget();
const context = vm.createContext({ console, performance, URL, URLSearchParams, Event, EventTarget, setTimeout,
  document: { getElementById: $, querySelectorAll: query => query === '[data-map]' ? tabs : [] }, window,
  location: { search: '' }, navigator: { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } },
  GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
  requestAnimationFrame: cb => calls.animation.push(cb),
  fetch: async () => ({ ok: true, blob: async () => ({}) }),
  __model: model, __image: image, __images: calls.images,
});
const result = await build({ entryPoints: [new URL('../models/supermat/examples/external-app/app.js', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', define: { 'import.meta.url': '"https://example.test/dist/app.js"' },
  plugins: [{ name: 'application-dependencies', setup(builder) {
    builder.onResolve({ filter: /^@kaminos\/supermat$|^lucide$|image-view\.js$|sample\.webp$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path.includes('image-view') ? 'export async function createImageView(){return {setImage(i){globalThis.__images.push(i)},fit(){},setZoom(){},destroy(){}}}' :
      args.path === 'lucide' ? 'export const Download=[],Maximize=[],Square=[],Pause=[],Play=[],Upload=[];export const createElement=()=>({});' :
      args.path.includes('sample.webp') ? 'export default "sample.webp";' :
      'export async function createSuperMatApp(){return globalThis.__model;} export async function decodeImageRgba(){return globalThis.__image;}' }));
  } }] });
await vm.runInContext(`(async()=>{${result.outputFiles[0].text}\n})()`, context);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
await settle();
assert.equal(calls.animation.length, 0, 'an idle material viewer must not run a diagnostic animation');
assert.equal(calls.load, 0, 'opening the application must not download weights');
assert.equal(calls.runs.length, 0, 'inference belongs to the user');
assert.equal(calls.images.at(-1), image, 'an included source image makes the first screen usable');
assert.equal(tabs[1].disabled, true, 'uninferred maps must not appear as results');

const click = element => element.onclick?.(new Event('click'));
const run = () => { click($('run')); return settle(); };
await run();
assert.equal(calls.runs.length, 1);
assert.equal(calls.runs[0].image, image);
assert.equal(calls.runs[0].size, 512);
assert.equal($('run').disabled, true);
assert.equal($('file').disabled, true);
await click($('pause')); assert.equal(calls.pause, 1);
await click($('pause')); assert.equal(calls.resume, 1);
const maps = Object.fromEntries(['albedo', 'roughness', 'metallic'].map(name => [name, { ...image, name }]));
resolveRun({ maps }); await settle();
assert.equal(calls.images.at(-1), maps.albedo);
assert.equal(tabs[1].disabled, false);
assert.equal(calls.destroyed, 0);
click(tabs[2]); assert.equal(calls.images.at(-1), maps.roughness);
await run();
rejectRun(new Error('Model interrupted')); await settle();
assert.match($('error').textContent, /Model interrupted/);
assert.equal(calls.images.at(-1), maps.roughness, 'failed inference retains the previous result');
assert.equal($('run').disabled, false);
await run();
await click($('stop')); assert.equal(calls.stop, 1);
const abort = new Error('Stopped'); abort.name = 'AbortError';
rejectRun(abort); await settle();
assert.equal($('run').disabled, false, 'stopping permits another run');
$('file').files = [{ name: 'another.png' }];
await $('file').onchange();
assert.equal(calls.images.at(-1), image);
assert.equal(tabs[1].disabled, true, 'new input must not inherit the old material maps');
assert.equal($('download').disabled, true);
await run(); resolveRun({ maps }); await settle();
assert.equal(calls.runs.length, 4);
assert.equal(calls.destroyed, 0);
window.dispatchEvent(new Event('pagehide')); await settle();
assert.equal(calls.destroyed, 1);
console.log('SuperMat starting application: user-driven inference, map inspection, repeat/retry, input identity and exit passed');
