import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Three from 'three';

const exercise = process.argv[2] ?? 'recovery';
for (const initiallyPaused of [false, true]) {
  const test = { models: [], geometries: [], failGeometry: false, failStep: false, renders: 0, steps: 0, frame: null };
  class BoxGeometry extends Three.BoxGeometry {
    constructor(...args) { if (test.failGeometry) throw new Error('injected geometry rejection'); super(...args); test.geometries.push(this); }
  }
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '80', validity: { valid: true }, textContent: '', attributes: {},
      setCustomValidity() {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, replaceChildren() {}, append() {} });
    return nodes.get(id);
  };
  const renderer = { setPixelRatio() {}, setSize() {}, render() { test.renders++; this.info.render.calls++; }, info: { compute: { calls: 0 }, render: { calls: 0, triangles: 12 } }, backend: {} };
  const device = { addEventListener() {}, lost: new Promise(() => {}), queue: { async onSubmittedWorkDone() { test.interference?.(); } } };
  const createModel = async () => {
    const model = { disposed: 0, cells: [{ index: 0, pinned: false, half: { x: .5, y: .5, z: .5 } }],
      snapshot: () => ({ step: 1 + test.steps, floorY: -1, dimensions: { dx: 1, dy: 1, dz: 1 }, config: { strength: 80, timeStep: 1 / 60 }, hand: null, broken: 0, events: [], bonds: [], bodies: [{ index: 0, pinned: false, position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }] }),
      async step() { if (test.failStep) throw new Error('injected simulation rejection'); test.steps++; renderer.info.compute.calls++; },
      isExposedFace: () => true, release() {}, dispose() { this.disposed++; } };
    test.models.push(model); return model;
  };
  globalThis.__archViewTest = { three: { ...Three, BoxGeometry }, createModel, renderer, device };
  Object.assign(globalThis, { innerWidth: 1280, innerHeight: 900, devicePixelRatio: 1,
    document: { querySelector: node, hidden: false, createElement: () => ({ addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 900 }) }) },
    window: {}, location: { search: initiallyPaused ? '?smoke=1' : '', href: 'synthetic-view-contract' },
    addEventListener() {}, requestAnimationFrame(callback) { test.frame = callback; }, fetch: async () => ({ ok: true, json: async () => ({ constructionSource: {}, source: {} }) }) });
  const source = fs.readFileSync(new URL('../structural-material-arch-gpu-view.js', import.meta.url), 'utf8')
    .replace("'./structural-material-arch-stones.js'", JSON.stringify(new URL('../structural-material-arch-stones.js', import.meta.url).href))
    .replace("import * as THREE from 'three/webgpu';", 'const THREE = globalThis.__archViewTest.three;')
    .replace("import { OrbitControls } from 'three/addons/controls/OrbitControls.js';", 'class OrbitControls { constructor(camera) { this.camera = camera; this.target = new THREE.Vector3(); } update() { this.camera.lookAt(this.target); } }')
    .replace("import { createElement, Pause, Play, RotateCcw, ZoomIn, ZoomOut } from 'lucide';", 'const createElement = () => ({}), Pause = {}, Play = {}, RotateCcw = {}, ZoomIn = {}, ZoomOut = {};')
    .replace("import { createNativeGpuRenderer } from './dist/structural-material-arch-gpu-engine.js';", 'const createNativeGpuRenderer = async () => ({ renderer: globalThis.__archViewTest.renderer, device: globalThis.__archViewTest.device, identity: {} });')
    .replace("import { createGpuArchCollapse, coarsenGpuArchProfile, ARCH_GPU_ROUTE } from './structural-material-arch-gpu.js';", 'const createGpuArchCollapse = globalThis.__archViewTest.createModel, coarsenGpuArchProfile = x => x, ARCH_GPU_ROUTE = "synthetic-view-contract";');
  const originalError = console.error; console.error = () => {};
  try {
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${exercise}-${initiallyPaused}`);
    const api = window.__archCollapse;
    assert.equal(api.witness().phase, 'interactive');
    const accepted = test.models[0];
    if (exercise === 'performance') {
      if (!initiallyPaused) node('#pause').onclick();
      const before = test.renders;
      test.interference = () => { node('#zoom-in').onclick(); node('#pause').onclick(); };
      const measured = await api.performanceTrial({ mode: 'solver', samples: 2, warmup: 1 });
      assert.equal(test.renders - before, 1, 'controls cannot add drawing to solver-only trial; final presentation is restored');
      assert.equal(api.witness().paused, true, 'trial controls cannot resume the clock');
      test.interference = null;
      const queued = api.performanceTrial({ mode: 'solver', samples: 2, warmup: 1 });
      node('#pause').onclick();
      await assert.rejects(queued, /paused ungripped arch/, 'admission is checked after entering the serialized queue');
      assert.equal(measured.observed.length, 2);
    } else if (exercise === 'frame') {
      const before = test.renders;
      await test.frame(performance.now() + 17);
      assert.equal(test.steps, initiallyPaused ? 0 : 1, 'live frame advances exactly one physical step');
      assert.equal(test.renders - before, 1, 'one animation frame submits one scene, including live simulation');
    } else if (exercise === 'replacement') {
      test.failGeometry = true;
      await assert.rejects(api.reset(), /injected geometry rejection/);
      assert.equal(accepted.disposed, 0, 'failed replacement must preserve the displayed model');
      assert.equal(test.models[1].disposed, 1, 'failed replacement must dispose the newly acquired model');
      assert.equal(api.witness().state.bodies.length, 1);
    } else {
      test.failStep = true;
      await assert.rejects(api.advance(1), /injected simulation rejection/);
      assert.equal(api.witness().phase, 'failed'); assert.equal(api.witness().paused, true);
      test.failStep = false;
      await api.reset();
      const recovered = api.witness();
      assert.equal(recovered.phase, 'interactive');
      assert.equal(recovered.paused, initiallyPaused, 'Reset must restore the clock state that preceded failure');
      assert.equal(recovered.failures.length, 1, 'recovery retains failure history');
      assert.equal(accepted.disposed, 1);
    }
  } finally { console.error = originalError; }
}
console.log(`GPU view ${exercise} contracts preserve ownership and the pre-failure clock`);
