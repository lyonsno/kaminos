// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as setupMod from '../local-liquid-setup.mjs';
import * as opticalQueryMod from '../local-liquid-optical-query.mjs';
import {
  buildSceneDocument,
  planSceneRestore,
} from '../scene-persistence-core.js';
import { createFingerFluidBenchState } from '../finger-fluid-bench-core.js';
import * as webgpuCoreMod from '../finger-fluid-webgpu-core.js';
import { waterControlsFixture } from './helpers/water-controls.mjs';
import { createMlsJuiceRenderer } from '../mls-juice-renderer.mjs';

const {
  DEFAULT_TRANSMISSION_MIN_CONTRIBUTION,
  defaultLocalLiquidSetup,
  normalizeLocalLiquidSetup,
} = setupMod;
const {
  localLiquidOpticalQueryControls,
  normalizeTransmissionMinContribution,
} = opticalQueryMod;
const { resolveFingerFluidTransmissionMinContribution } = webgpuCoreMod;

// 1. Default & validation in local-liquid-setup.mjs + scene save/restore persistence
assert.equal(DEFAULT_TRANSMISSION_MIN_CONTRIBUTION, 0.25, 'default transmission contribution cutoff must be 0.25');
assert.equal(defaultLocalLiquidSetup().transmissionMinContribution, 0.25);
assert.equal(normalizeLocalLiquidSetup({ ...defaultLocalLiquidSetup(), transmissionMinContribution: undefined }).transmissionMinContribution, 0.25);
assert.equal(normalizeLocalLiquidSetup({ ...defaultLocalLiquidSetup(), transmissionMinContribution: 0.35 }).transmissionMinContribution, 0.35);
assert.equal(normalizeLocalLiquidSetup({ ...defaultLocalLiquidSetup(), transmissionMinContribution: 0 }).transmissionMinContribution, 0);
assert.equal(normalizeLocalLiquidSetup({ ...defaultLocalLiquidSetup(), transmissionMinContribution: 1 }).transmissionMinContribution, 1);
for (const invalid of [-0.01, 1.01, NaN, Infinity, '0.25']) {
  assert.throws(
    () => normalizeLocalLiquidSetup({ ...defaultLocalLiquidSetup(), transmissionMinContribution: invalid }),
    /transmissionMinContribution/,
    `invalid transmissionMinContribution ${String(invalid)} must fail loud`,
  );
}

{
  const doc = buildSceneDocument({
    objects: [],
    groups: [],
    selection: { ids: [], activeId: null },
    activeFieldId: 'water-field',
    volumePrimitives: [],
    flame: null,
    localLiquid: normalizeLocalLiquidSetup({ ...defaultLocalLiquidSetup(), transmissionMinContribution: 0.32 }),
    camera: { position: [0, 1, 3], target: [0, 0, 0], fov: 50 },
    environment: { preset: 'studio' },
    viewportDisplay: {},
  });
  assert.equal(doc.localLiquid.transmissionMinContribution, 0.32, 'saved scene document must persist transmissionMinContribution');
  const restored = planSceneRestore(doc);
  assert.equal(restored.localLiquid.transmissionMinContribution, 0.32, 'restored scene must preserve saved transmissionMinContribution');

  const legacyDoc = structuredClone(doc);
  delete legacyDoc.localLiquid.transmissionMinContribution;
  const restoredLegacy = planSceneRestore(legacyDoc);
  assert.equal(restoredLegacy.localLiquid.transmissionMinContribution, 0.25, 'legacy saved scene without field must default to 0.25');
}

// 2. Optical query controls, bench state, and WebGPU core resolver
assert.equal(normalizeTransmissionMinContribution(), 0.25);
assert.equal(normalizeTransmissionMinContribution(0.4), 0.4);
assert.deepEqual(localLiquidOpticalQueryControls(null, false), [0, 0, 0, 0.25]);
assert.deepEqual(localLiquidOpticalQueryControls({ near: 0.1, far: 100 }, true, 0.3), [1, 100, 0.1, 0.3]);
assert.throws(() => localLiquidOpticalQueryControls({ near: 0.1, far: 100 }, true, -0.1), /transmissionMinContribution/);

assert.equal(createFingerFluidBenchState({}).renderer.transmissionMinContribution, 0.25);
assert.equal(createFingerFluidBenchState({ transmissionMinContribution: 0.18 }).renderer.transmissionMinContribution, 0.18);
assert.equal(resolveFingerFluidTransmissionMinContribution(), 0.25);
assert.equal(resolveFingerFluidTransmissionMinContribution(0.25), 0.25);
assert.throws(() => resolveFingerFluidTransmissionMinContribution(1.5), /transmissionMinContribution/i);

// 3. Shader transmission-contribution ray cutoff in finger-fluid-webgpu-core.js
{
  const webgpuSource = fs.readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
  const start = webgpuSource.indexOf('  var queryValidity = select(0.0, 1.0, exitValidity > 0.5);');
  const end = webgpuSource.indexOf('  let geometricPathKnown =', start);
  assert.ok(start > 0 && end > start, 'fs_refraction queryValidity block must exist');
  const snippet = webgpuSource.slice(start, end);
  assert.match(snippet, /transmissionMinContribution/, 'fs_refraction must read transmissionMinContribution');
  assert.match(snippet, /transmissionContribution/, 'fs_refraction must evaluate transmissionContribution before ray marching');
  assert.match(snippet, /transmissionRayActive/, 'fs_refraction must gate ray evaluation on transmissionRayActive');

  const jsSnippet = snippet
    .replace(/\bvar\s+/g, 'let ')
    .replace(/vec3<f32>/g, 'vec3')
    .replace('params.cameraPosition.xyz - prelimWorldPos', 'subVec(params.cameraPosition.xyz, prelimWorldPos)')
    .replace('-liquidCameraDirection(pixel)', 'negVec(liquidCameraDirection(pixel))')
    .replace('-select(', 'scaleVec(select(')
    .replace(') * prelimSlabPath', '), -prelimSlabPath)')
    .replace(/: f32/g, '') + '\n({ queryValidity, transmissionContribution, transmissionRayActive, prelimSlabPath });';

  function evalCutoff({ exitValidity = 1, fresnel = 0.04, maxAbs = 0.8, cutoff = 0.25, debugMode = 0 }) {
    const ndv = Math.max(0, Math.min(1, 1 - Math.pow((fresnel - 0.02037) / (1 - 0.02037), 1 / 5)));
    return vm.runInNewContext(jsSnippet, {
      exitValidity,
      thickness: 0.5,
      geometricPathLength: 0.4,
      opticalLightingMode: 0,
      pixel: [0, 0],
      shadingDepth: 1.0,
      hostTransport: true,
      opticalDebugMode: debugMode,
      params: {
        hostFrameControls: { w: cutoff },
        cameraPosition: { xyz: [0, 0, 0] },
      },
      select: (a, b, cond) => (cond ? b : a),
      clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
      mix: (a, b, t) => a * (1 - t) + b * t,
      max: Math.max,
      pow: Math.pow,
      dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
      exp: () => ({ r: maxAbs, g: maxAbs * 0.5, b: maxAbs * 0.25 }),
      vec3: (x, y = x, z = x) => [x, y, z],
      subVec: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
      negVec: a => [-a[0], -a[1], -a[2]],
      scaleVec: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
      coherentSlabDepth: () => 1.0,
      reconstructWorldPosition: () => [0, 0, -1],
      liquidCameraDirection: () => [0, 0, -1],
      normalize: v => v,
      reconstructWorldReflectionNormal: () => [0, Math.sqrt(Math.max(0, 1 - ndv * ndv)), ndv],
    });
  }

  const above = evalCutoff({ fresnel: 0.1, maxAbs: 0.5, cutoff: 0.25 });
  assert.ok(above.transmissionContribution >= 0.25);
  assert.equal(above.transmissionRayActive, true);
  assert.equal(above.queryValidity, 1.0, 'above cutoff must keep queryValidity active');

  const belowAbsorption = evalCutoff({ fresnel: 0.1, maxAbs: 0.2, cutoff: 0.25 });
  assert.ok(belowAbsorption.transmissionContribution < 0.25);
  assert.equal(belowAbsorption.transmissionRayActive, false);
  assert.equal(belowAbsorption.queryValidity, 0.0, 'below cutoff (high absorption) must skip ray queries');
  assert.equal(belowAbsorption.prelimSlabPath, 0.4, 'prelimSlabPath must still preserve true geometricPathLength');

  const belowFresnel = evalCutoff({ fresnel: 0.8, maxAbs: 0.9, cutoff: 0.25 });
  assert.ok(belowFresnel.transmissionContribution < 0.25);
  assert.equal(belowFresnel.transmissionRayActive, false);
  assert.equal(belowFresnel.queryValidity, 0.0, 'below cutoff (grazing Fresnel) must skip ray queries');

  const debugOverride = evalCutoff({ fresnel: 0.8, maxAbs: 0.2, cutoff: 0.25, debugMode: 19 });
  assert.equal(debugOverride.transmissionRayActive, true, 'hit-kind debug mode must preserve ray evaluation');
  assert.equal(debugOverride.queryValidity, 1.0);
}

// 4. Water simulation inspector UI, undo/redo, and live MLS host update without Restart
{
  const f = waterControlsFixture();
  const read = f.api.read;
  let simulation = {
    present: true,
    selected: true,
    sourceCount: 1,
    settings: { particleCount: 12000, transmissionMinContribution: 0.25 },
    sampling: { spacing: 0.05, particleTarget: 1000, container: { min: [-2, -1, -2], max: [2, 3, 2] } },
  };
  let lastPatch = null;
  f.api.read = () => ({ ...read(), simulation });
  f.api.editSimulation = patch => {
    lastPatch = patch;
    simulation = { ...simulation, settings: { ...simulation.settings, ...patch } };
  };
  f.controls.refresh();
  assert.equal(Number(f.input('[data-transmission-cutoff]').value), 0.25, 'inspector must display default 0.25 cutoff');
  f.input('[data-transmission-cutoff]').value = 0.35;
  f.input('[data-transmission-cutoff]').listeners.input();
  await f.controls.flush();
  assert.equal(lastPatch?.transmissionMinContribution, 0.35, 'inspector edit must flush transmissionMinContribution');
  f.controls.refresh();
  assert.equal(Number(f.input('[data-transmission-cutoff]').value), 0.35);

  const hostText = fs.readFileSync(new URL('../authored-mls-host.mjs', import.meta.url), 'utf8');
  const pendingExpression = hostText.match(/pendingSourceChanges:(.*),\n/)[1];
  const evalPending = (records, initial, saved, next) =>
    new Function('records', 'initial', 'setup', 'pendingSetup', `return ${pendingExpression}`)(
      records,
      initial,
      saved,
      next,
    );
  const baseSetup = defaultLocalLiquidSetup();
  assert.equal(
    evalPending([], { mode: 'finite_drop', sourceRecords: [] }, baseSetup, {
      ...baseSetup,
      transmissionMinContribution: 0.4,
    }),
    false,
    'live optical cutoff change must not mark MLS simulation as needing a Restart',
  );
  assert.equal(
    evalPending([], { mode: 'finite_drop', sourceRecords: [] }, baseSetup, {
      ...baseSetup,
      particleCount: 24000,
    }),
    true,
    'capacity change must still mark MLS simulation as needing a Restart',
  );
}

// 5. MLS two-interface optical slab renderer + live transmissionMinContribution cutoff
{
  globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 };
  globalThis.GPUBufferUsage = { UNIFORM: 4, COPY_DST: 8 };
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
  const shaderCodes = [];
  const uniformWrites = [];
  const renderedPasses = [];
  const device = {
    createSampler: () => ({}),
    createBuffer: ({ size }) => ({ size, destroy() {} }),
    createShaderModule: ({ code }) => {
      shaderCodes.push(code);
      return { getCompilationInfo: async () => ({ messages: [] }) };
    },
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipelineAsync: async desc => ({ desc, getBindGroupLayout: () => ({}) }),
    createTexture: desc => ({ desc, createView: () => ({ desc }), destroy() {} }),
    createBindGroup: desc => desc,
    queue: {
      writeBuffer: (buf, offset, data) => {
        uniformWrites.push(new Float32Array(data.slice()));
      },
    },
  };
  const solver = {
    particleBuffer: {},
    config: { capacity: 4096, cell: 0.05, min: [-1.6, -0.1, -1.6], particleRadius: 0.0325 },
  };
  const renderer = await createMlsJuiceRenderer({
    device,
    solver,
    hostEnvironment: true,
    transmissionMinContribution: 0.25,
  });
  assert.equal(shaderCodes.length, 3);
  const wgsl = shaderCodes.join('\n');
  assert.match(wgsl, /fn fs_back/, 'MLS renderer must include back-surface exit depth pass');
  assert.match(wgsl, /refract\(viewDir,\s*transportN,\s*1\.0\s*\/\s*1\.333\)/, 'MLS renderer must perform entry Snell refraction');
  assert.match(wgsl, /refract\(insideRay,\s*-exitN,\s*1\.333\)/, 'MLS renderer must perform exit Snell refraction');
  assert.match(wgsl, /transmissionContribution\s*>=\s*transmissionMinContribution/, 'MLS renderer must gate exit refraction ray cone on transmissionMinContribution');

  assert.equal(renderer.read().transmissionMinContribution, 0.25);
  assert.equal(renderer.read().refractionCutoffEnabled, true);
  assert.ok(renderer.read().passes.includes('back_depth'), 'MLS renderer passes must include back_depth');

  renderer.setOpticalSettings({ transmissionMinContribution: 0.4 });
  assert.equal(renderer.read().transmissionMinContribution, 0.4);
  assert.throws(() => renderer.setOpticalSettings({ transmissionMinContribution: -0.1 }), /transmissionMinContribution/);

  const encoder = {
    beginRenderPass: desc => {
      renderedPasses.push(desc);
      return {
        setPipeline() {},
        setBindGroup() {},
        draw() {},
        end() {},
      };
    },
  };
  const hostCamera = {
    near: 0.1,
    far: 100,
    projectionMatrix: { elements: new Float32Array(16) },
    projectionMatrixInverse: { elements: new Float32Array(16) },
    matrixWorldInverse: { elements: new Float32Array(16) },
    matrixWorld: { elements: new Float32Array(16) },
  };
  renderer.encode({
    encoder,
    hostCamera,
    environment: {},
    sceneColor: {},
    sceneDepth: {},
    target: {},
    width: 320,
    height: 200,
  });
  assert.equal(renderedPasses.length, 6, 'MLS two-interface slab renderer must execute 6 passes (front, back, thick, blur H, blur V, compose)');
  const lastUniform = uniformWrites.at(-1);
  assert.ok(Math.abs(lastUniform[72] - 0.4) < 1e-6, 'uniform buffer must receive updated transmissionMinContribution (0.4)');
  renderer.dispose();
}

console.log('All transmission cutoff, persistence, inspector, and MLS optical slab renderer tests passed');
