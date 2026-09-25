import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Failure paths the kiln host added to index.html must report the actual
// failure: the light-field debug fallback names the shared-device reason, and
// only an authored composition restore failure blocks saving.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (start, end) => {
  const at = html.indexOf(start);
  assert.ok(at >= 0, `missing ${start}`);
  const stop = html.indexOf(end, at + start.length);
  assert.ok(stop > at, `missing ${end}`);
  return html.slice(at, stop);
};

// Light-field debug fallback when the receiver pass was never constructed.
const debugFallback = slice('window.kaminosFireLightFieldDebugState = ', 'window.kaminosFireLightFieldSetWitnessMute');
const debugContext = vm.createContext({
  window: {}, fireLightFieldPass: null, isFireLightFieldRoute: () => true,
  sharedGpu: null, sharedGpuFailureReason: 'WebGPU adapter unavailable',
});
vm.runInContext(`'use strict'; ${debugFallback}`, debugContext);
const state = debugContext.window.kaminosFireLightFieldDebugState();
assert.equal(state.status, 'pass-not-constructed');
assert.equal(state.reason, 'shared-device-unavailable: WebGPU adapter unavailable');
assert.equal(state.sharedDeviceFailureReason, 'WebGPU adapter unavailable');

// Scene route restore: ordinary routes must not be blocked or blamed on a
// composition restore that never ran.
const restore = slice('  Promise.all([environmentLoaded, volumeLoaded]).then(', '  initKaminosMotionAgencyRoute();');
async function runRestore(hash, environmentLoaded) {
  const calls = { info: [], composition: [], console: [] };
  const context = vm.createContext({
    Promise, URLSearchParams, location: { hash, search: '' }, document: { body: { classList: { add() {} } } },
    environmentLoaded, volumeLoaded: Promise.resolve(), sceneSaveBlockedByFailedRestore: false,
    setActiveTab() {}, setInfo: message => calls.info.push(message),
    compositionStatus: message => calls.composition.push(message),
    console: { error: (...args) => calls.console.push(args.join(' ')) },
    fetch: async () => ({ ok: false }), planSceneRestore() {}, loadSceneFile: async () => {}, File: class {},
  });
  vm.runInContext(restore, context);
  for (let turn = 0; turn < 10; turn += 1) await new Promise(resolve => setImmediate(resolve));
  return { blocked: context.sceneSaveBlockedByFailedRestore, calls };
}
const ordinary = await runRestore('', Promise.reject(new Error('mesh route failed')));
assert.equal(ordinary.blocked, false, 'ordinary-route load failure does not block saving');
assert.ok(!ordinary.calls.info.some(message => /Composition restore failed/.test(message)), 'no composition blame on ordinary routes');
assert.ok(ordinary.calls.console.some(message => /mesh route failed/.test(message)), 'ordinary-route failure remains visible');
const authored = await runRestore('#authoring=1&scene=kiln.kaminos.json', Promise.resolve());
assert.equal(authored.blocked, true, 'failed authored restore blocks saving');
assert.ok(authored.calls.info.some(message => /Composition restore failed: Scene unavailable/.test(message)));
console.log('kiln host failure reporting contracts passed');
