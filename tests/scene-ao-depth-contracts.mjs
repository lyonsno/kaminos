import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helper = new URL('../scene-ao-depth.mjs', import.meta.url);
const configureMaterialSideAODepth = existsSync(helper)
  ? (await import(helper)).configureMaterialSideAODepth : undefined;
const materials = [{ side: 2 }, { side: 0 }, { side: 1 }, { side: 2 }];
const draws = [];
const originalOverride = { name: 'original' };
const originalCallback = () => {};
const scene = { overrideMaterial: originalOverride };
const camera = {};
const depthRT = {};
const depthMaterial = { side: 0 };
let computeCalls = 0, configuredDepth;
const renderer = {
  target: 'original-target', callback: originalCallback,
  setRenderTarget(value) { this.target = value; },
  setRenderObjectFunction(value) { this.callback = value; },
  renderObject(object, activeScene, activeCamera, geometry, material, group, lights, clipping, passId) {
    draws.push({ side: activeScene.overrideMaterial.side, material, group, passId });
    if (object.fail) throw new Error('draw failed');
  },
  render(activeScene, activeCamera) {
    materials.forEach((material, i) => (this.callback || this.renderObject).call(this,
      { fail: this.fail && i === 1 }, activeScene, activeCamera, {}, material, { index: i }, {}, {}, 'depth'));
  },
};
const RendererUtils = {
  resetRendererAndSceneState(renderer, scene) {
    const state = { target: renderer.target, callback: renderer.callback, override: scene.overrideMaterial };
    renderer.callback = null; scene.overrideMaterial = null;
    return state;
  },
  restoreRendererAndSceneState(renderer, scene, state) {
    renderer.target = state.target; renderer.callback = state.callback; scene.overrideMaterial = state.override;
  },
};
const node = {
  setDepthPass(...args) { configuredDepth = args; },
  updateBefore({ renderer }) {
    // Observed bundled GTAOCompute route: reset, override, draw, restore, compute.
    if (configuredDepth?.[0]) {
      const state = RendererUtils.resetRendererAndSceneState(renderer, scene);
      scene.overrideMaterial = configuredDepth[1]; renderer.setRenderTarget(configuredDepth[0]);
      renderer.render(scene, camera);
      RendererUtils.restoreRendererAndSceneState(renderer, scene, state);
    }
    assert.equal(this, node);
    computeCalls++;
  },
};
const start = source.indexOf('  aoPass = aoCompute(');
const end = source.indexOf('  const aoResolved', start);
assert.ok(start >= 0 && end > start);
vm.runInNewContext(source.slice(start, end), {
  aoPass: null, aoCompute: () => node, depthTexNode: {}, normalTexNode: {},
  scene, camera, depthRT, depthMaterial, configureMaterialSideAODepth, THREE: { RendererUtils },
});
node.updateBefore({ renderer });
assert.deepEqual(draws.map(draw => draw.side), [2, 0, 1, 2],
  'AO depth must use the visible source material side, including mixed material groups');
assert.equal(computeCalls, 1);
assert.equal(depthMaterial.side, 0);
assert.equal(scene.overrideMaterial, originalOverride);
assert.equal(renderer.callback, originalCallback);
assert.equal(renderer.target, 'original-target');
assert.deepEqual(materials.map(material => material.side), [2, 0, 1, 2]);
assert.deepEqual(draws.map(draw => draw.group.index), [0, 1, 2, 3]);
assert.ok(draws.every(draw => draw.passId === 'depth'));

draws.length = 0;
materials[0].side = 1;
node.updateBefore({ renderer });
assert.deepEqual(draws.map(draw => draw.side), [1, 0, 1, 2], 'live side changes must not use stale cached policy');
renderer.fail = true;
assert.throws(() => node.updateBefore({ renderer }), /draw failed/);
assert.equal(computeCalls, 2, 'failed depth must not proceed with stale AO inputs');
assert.equal(depthMaterial.side, 0);
assert.equal(scene.overrideMaterial, originalOverride);
assert.equal(renderer.callback, originalCallback);
assert.equal(renderer.target, 'original-target');
console.log('scene AO material-side depth contracts passed');
