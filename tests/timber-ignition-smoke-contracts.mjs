import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /mountTimberIgnitionSmoke/, 'the saved-scene route must mount the operator sequence after restoring its objects');
const {createTimberIgnitionSmoke, TIMBER_IGNITION_BASIN} = await import('../timber-ignition-smoke.mjs');
const scene = JSON.parse(readFileSync(new URL('../scenes/sinter-timber-ignition-operator.kaminos.json', import.meta.url)));
assert.deepEqual(scene.objects.map(object => object.transform.position), [[0, -0.5, 0], [2.5, 0.1, 0]]);
assert.deepEqual(scene.objects[0].transform.scale, [0.8, 0.8, 0.8]);
assert.deepEqual(scene.objects[0].transform.rotation, [0, 0, 0.35]);

function fixture() {
  const events = [];
  const objects = structuredClone(scene.objects);
  const state = {
    active: true, backend: 'WebGPU:apple', effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    simGrid: 48, simGridDimensions: [48, 96, 48], simStepCount: 2,
    controls: {flowRate: 1}, analyticEmitterDispatchActive: true,
    gpuStructuralCombustionAssembly: {structureCount: 2, dispatchCount: 2, meshTriangleCount: 1728,
      runtimeReadbackCount: 0, hostCausalFeedbackCount: 0, presentationDebugMode: 'off'},
    combustibleObjectSource: {sameDevice: true},
  };
  const volume = {
    debugState: () => structuredClone(state),
    pauseSelectiveHeadLiveAtSimStep: async target => {
      events.push(['advance', target]); state.simStepCount = target;
      state.selectiveHeadLiveCapturePaused = true;
      return {ok: true, gpuComplete: true, paused: true, effectiveSimStepCount: target};
    },
    setSelectiveHeadLiveCapturePaused: paused => {state.selectiveHeadLiveCapturePaused = paused; return {paused};},
    setSimulationPaused: paused => {state.simulationPaused = paused; return {paused};},
    setControls: controls => {events.push(['controls', controls]); Object.assign(state.controls, controls);},
    setAnalyticEmitterDescriptor: descriptor => {
      events.push(['emitter', descriptor]); state.analyticEmitterDispatchActive = false;
      return {mode: 'off', count: 0, sourceLaw: 'inactive'};
    },
  };
  const smoke = createTimberIgnitionSmoke({volume, basin: () => TIMBER_IGNITION_BASIN,
    objects: () => objects, moveObject: (id, pose) => {
      events.push(['move', id, pose]); const object = objects.find(item => item.id === id);
      Object.assign(object.transform, pose); return structuredClone(object);
    }});
  return {smoke, events, state, volume, objects};
}
const good = fixture();
await good.smoke.initialize();
assert.equal(good.smoke.status().phase, 'paused');
assert.equal(good.state.simStepCount, 3);
assert.equal(good.state.simulationPaused, true, 'cold scene inspection must not consume the material');
assert.equal(good.state.selectiveHeadLiveCapturePaused, false, 'cold scene must keep presenting camera movement');
await good.smoke.run();
assert.deepEqual(good.events, [
  ['advance', 3], ['advance', 243], ['controls', {flowRate: 0}], ['emitter', null],
  ['move', 'sinter-source-timber', {position: [0.4, -0.55, 0]}],
  ['move', 'sinter-receiver-timber', {position: [0.4, 0.6, 0]}], ['advance', 603],
]);
assert.equal(good.smoke.status().phase, 'live', 'the prescribed sequence must enter the continuing operator preview');
assert.equal(good.smoke.status().running, true);
assert.equal(good.smoke.status().simStepCount, 603);
assert.equal(good.state.simulationPaused, false, 'the operator preview must continue computing beyond the receipt endpoint');
assert.equal(good.state.selectiveHeadLiveCapturePaused, false, 'completed sequence must keep presenting camera movement');
assert.ok(!JSON.stringify(good.smoke.status()).includes('ignited'), 'scripted completion cannot assert a material result');
const beforePause = structuredClone(good.events);
good.smoke.togglePause();
assert.equal(good.state.simulationPaused, true, 'operator pause must work after the finite sequence');
assert.equal(good.state.selectiveHeadLiveCapturePaused, false, 'operator pause must retain a live camera');
assert.equal(good.smoke.status().paused, true);
good.smoke.togglePause();
assert.equal(good.state.simulationPaused, false);
assert.equal(good.smoke.status().paused, false);
assert.deepEqual(good.events, beforePause, 'pause/resume must not restore the burner or reposition timbers');
await assert.rejects(good.smoke.run(), /reset/);
for (const mutate of [
  state => {state.backend = 'unavailable';},
  state => {state.effectiveRoute = 'fallback';},
  state => {state.simGrid = 96;},
  state => {state.simGridDimensions = [48, 48, 48];},
  state => {state.gpuStructuralCombustionAssembly.structureCount = 1;},
  state => {state.gpuStructuralCombustionAssembly.runtimeReadbackCount = 1;},
  state => {state.gpuStructuralCombustionAssembly.presentationDebugMode = 'material';},
  state => {state.combustibleObjectSource.sameDevice = false;},
  state => {state.controls.flowRate = 0;},
]) {
  const bad = fixture(); mutate(bad.state);
  await assert.rejects(bad.smoke.initialize());
  assert.equal(bad.events.length, 0, 'a wrong route cannot advance the sequence');
}
const badPause = fixture();
badPause.volume.pauseSelectiveHeadLiveAtSimStep = async () => ({ok: false, gpuComplete: false});
await assert.rejects(badPause.smoke.initialize(), /GPU-complete/);
assert.equal(badPause.smoke.status().phase, 'failed');
const burner = fixture(); await burner.smoke.initialize();
burner.volume.setAnalyticEmitterDescriptor = () => ({mode: 'analytic', count: 1});
await assert.rejects(burner.smoke.run(), /burner/);
assert.ok(!burner.events.some(event => event[0] === 'move'), 'failed burner shutdown must prevent transfer placement');
const stale = fixture(); stale.objects[1].transform.position = [0.4, 0.6, 0];
await assert.rejects(stale.smoke.initialize(), /pose/);
const continuation = fixture(); await continuation.smoke.initialize();
continuation.volume.setSimulationPaused = () => ({paused:true});
await assert.rejects(continuation.smoke.run(), /Live simulation continuation failed/);
assert.equal(continuation.smoke.status().phase, 'failed', 'a rejected continuation cannot look like a live preview');
console.log('timber ignition operator smoke contracts: ok');
