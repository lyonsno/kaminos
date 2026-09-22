import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule } from 'node:vm';

const packageRoot = new URL('../', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
assert.equal(packageJson.exports['./core'], './src/core.js', 'publish the model-neutral core entrypoint');
assert.equal(packageJson.exports['./sam'], './src/sam.js', 'publish the SAM entrypoint');

// Use the JavaScript module linker, not text matching, to inspect transitive imports.
const modules = new Map();
async function load(url) {
  if (!modules.has(url)) {
    const source = await readFile(new URL(url), 'utf8');
    modules.set(url, new SourceTextModule(source, { identifier: url }));
  }
  return modules.get(url);
}
const coreModule = await load(new URL('src/core.js', packageRoot).href);
await coreModule.link((specifier, parent) => load(new URL(specifier, parent.identifier).href));
for (const url of modules.keys()) {
  const name = new URL(url).pathname.split('/').at(-1);
  assert.doesNotMatch(name, /^(sam|moge-|sharp-|sf3d-|kimodo-)/, `core loads model implementation: ${name}`);
}

const root = await import('@kaminos/webgpu-inference-kit');
const core = await import('@kaminos/webgpu-inference-kit/core');
const sam = await import('@kaminos/webgpu-inference-kit/sam');
for (const [name, value] of Object.entries(core)) {
  assert.equal(root[name], value, `core export identity: ${name}`);
  assert.equal(name in sam, false, `ambiguous core/SAM API: ${name}`);
}
for (const [name, value] of Object.entries(sam)) {
  assert.equal(root[name], value, `SAM export identity: ${name}`);
}
for (const name of ['createWebGpuInferenceSession', 'createWebGpuForegroundService',
  'createWebGpuResourceFactory', 'createWebGpuScratchArena', 'defineComputeKernel']) {
  assert.equal(typeof core[name], 'function', `core runtime capability: ${name}`);
}
assert.equal(typeof sam.createSam3BrowserServingResources, 'function');
assert.equal(typeof sam.createSam31BrowserTrackerSession, 'function');
assert.equal(typeof sam.createSam3BrowserImageRuntime, 'function');
assert.equal(typeof sam.createSam3SourceMask, 'function');
assert.equal(typeof sam.resizeSam3MaskLogits, 'function');
for (const name of ['createSharpImageToSplatRouteDefinition', 'createSf3dImageToMeshRouteDefinition',
  'createMogeDepthNormalRouteDefinition', 'createKimodoTextToMotionRouteDefinition']) {
  assert.equal(typeof root[name], 'function', `legacy model adapter: ${name}`);
  assert.equal(name in core, false);
}
console.log(`package entrypoints passed: ${modules.size} core modules; ${Object.keys(core).length} core and ${Object.keys(sam).length} SAM exports`);
