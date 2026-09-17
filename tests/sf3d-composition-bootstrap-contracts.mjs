import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = source.indexOf('async function initScene()');
const setup = source.slice(start, source.indexOf('  renderer = sharedGpu?.device', start));
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const execute = new AsyncFunction('window', 'requestKaminosSharedWebGpuDevice', 'importCompositionModule', 'console', `
  let sharedGpu, sharedGpuFailureReason, compositionModule, compositionSetupError, scene, camera;
  const initializeHybridSplatOverlayModuleUrl = async () => {};
  const document = {getElementById: () => ({clientWidth: 100, clientHeight: 100})};
  const THREE = {Scene: class {}, PerspectiveCamera: class {position = {set(){}}}};
  ${setup}
  return {sharedGpu, compositionModule};
  }
  return initScene();
`);
const requirements = {maxBufferSize: 905969664, maxStorageBufferBindingSize: 905969664};
const module = {sharedGpuBufferRequirements: requirements, mountComposition() {}};
let events = [];
const sharedGpu = {device: {}};
const acquire = async options => {events.push(['acquire', options]); return sharedGpu;};
const load = async url => {events.push(['import', url]); return module;};
const window = {location: {hash: '#composition_module_url=./sf3d-live-flame-inject.mjs'}};
await execute(window, acquire, load, {warn() {}});
assert.equal(events[0][0], 'import', 'composition requirements must load before host device acquisition');
assert.equal(events[1][1].bufferRequirements, requirements);
events = [];
await assert.rejects(execute(window, async () => {throw new Error('unsupported capacity');}, load, {warn() {}}), /unsupported capacity/);
assert.equal(window.__kaminosCompositionSetup.phase, 'shared-device-acquisition');
assert.equal(window.__kaminosCompositionSetup.status, 'failed');
await assert.rejects(execute(window, acquire, async () => {throw new Error('module unavailable');}, {warn() {}}), /module unavailable/);
assert.equal(window.__kaminosCompositionSetup.phase, 'module-load');
await assert.rejects(execute(window, acquire, async () => ({}), {warn() {}}), /mountComposition/);
events = [];
const ordinary = await execute({location: {hash: ''}}, acquire, load, {warn() {}});
assert.equal(events.length, 1);
assert.deepEqual(events[0], ['acquire', {bufferRequirements: {}}]);
assert.equal(ordinary.sharedGpu, sharedGpu);
const fallback = await execute({location: {hash: ''}}, async () => {throw new Error('no shared device');}, load, {warn() {}});
assert.equal(fallback.sharedGpu, null, 'ordinary host keeps its existing fallback');
const legacy = await execute(window, async () => {throw new Error('no shared device');}, async () => ({mountComposition() {}}), {warn() {}});
assert.equal(legacy.sharedGpu, null, 'legacy composition without requirements keeps existing fallback');
// A malformed declared requirement is not absence and cannot enable fallback.
await assert.rejects(execute(window, async options => {assert.equal(options.bufferRequirements, null); throw new Error('invalid requirements');}, async () => ({mountComposition() {}, sharedGpuBufferRequirements: null}), {warn() {}}), /invalid requirements/);
assert.match(source, /if \(compositionSetupError\) throw compositionSetupError;/, 'outer scene recovery cannot launch a separate volume device after strict setup failure');
assert.match(source, /mountComposition\(\{[^}]*sharedGpu[\s\S]*?\}\)/, 'mount forwards the acquired host context');
console.log('SF3D composition bootstrap and fallback contracts passed');
