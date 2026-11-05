// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSceneBurning} from '../scene-burning.mjs';

test('LOD completion refreshes assets without replacing resident burn history', async () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const a = page.indexOf('const refreshSceneObjectsForLodSource ='), b = page.indexOf('\nwindow.__kaminosRefreshLodSource', a);
  assert.ok(a >= 0 && b > a);
  const source = 'a'.repeat(64), object = {}, entry = {id: 'burning', object, burnable: {enabled: true}};
  let constructions = 0, disposals = 0, refreshes = 0, consumer;
  const state = {fields: [{surfaceLod: {tier: 'hero'}, steps: 71, fuel: .42}], fracture: {broken: 3}};
  const runtime = {debugState: () => ({active: true}), borrowThermalGpuContext: async () => ({}),
    bindGpuThermalConsumer(value) { consumer = value; return () => {}; }};
  const sceneBurning = createSceneBurning({objects: () => [entry], runtime: () => runtime,
    createGas: async () => ({descriptor: {}, dispose() {}, read: () => ({})}),
    createBody: async () => { constructions++; return {
      read: () => state, setMounted() {}, setSettings() {}, dispose() { disposals++; },
    }; },
  });
  await sceneBurning.sync();
  const context = vm.createContext({workingScene: {objects: [entry]}, sceneGiProxies: {get: () => ({heroSha: source})},
    applyGiProxySetting: async () => { refreshes++; }, sceneBurning});
  vm.runInContext(page.slice(a, b) + '\nglobalThis.refresh = refreshSceneObjectsForLodSource;', context);
  await context.refresh(source); await sceneBurning.sync();
  assert.equal(refreshes, 1);
  assert.equal(constructions, 1, 'Asset optimization must not recreate live material or mechanics');
  assert.equal(disposals, 0);
  assert.equal(sceneBurning.read(entry.id).state, state);
  assert.equal(consumer.read().objects[0].fields[0].steps, 71);
  await sceneBurning.dispose();
});
