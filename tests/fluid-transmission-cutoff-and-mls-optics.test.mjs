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
  const end = webgpuSource.indexOf('  if (!submergedSurface && queryValidity > 0.5)', start);
  assert.ok(start > 0 && end > start, 'fs_refraction queryValidity block must exist');
  const snippet = webgpuSource.slice(start, end);
  assert.match(snippet, /transmissionMinContribution/, 'fs_refraction must read transmissionMinContribution');
  assert.match(snippet, /transmissionContribution/, 'fs_refraction must evaluate transmissionContribution before outgoing ray marching');
  assert.match(snippet, /transmissionRayActive/, 'fs_refraction must gate outgoing ray evaluation on transmissionRayActive');

  const jsSnippet = snippet
    .replace(/\bvar\s+/g, 'let ')
    .replace(/\blet\s+(queryValidity|waterPath|queryOrigin|queryDirection|submergedSurface|refractionQuery)\b/g, 'var $1')
    .replace(/vec3<f32>/g, 'vec3')
    .replace('params.cameraPosition.xyz - prelimWorldPos', 'subVec(params.cameraPosition.xyz, prelimWorldPos)')
    .replace('-liquidCameraDirection(pixel)', 'negVec(liquidCameraDirection(pixel))')
    .replace('exitWorldPosition + outgoingWorldRay * 0.035', '[0, 0, 0]')
    .replace('-select(', 'scaleVec(select(')
    .replace(') * prelimSlabPath', '), -prelimSlabPath)')
    .replace(/: f32/g, '') + '\n({ queryValidity, transmissionContribution, transmissionRayActive, prelimSlabPath });';

  function evalCutoff({ exitValidity = 1, fresnel = 0.04, maxAbs = 0.8, cutoff = 0.25, debugMode = 0 }) {
    const ndv = Math.max(0, Math.min(1, 1 - Math.pow((fresnel - 0.02037) / (1 - 0.02037), 1 / 5)));
    return vm.runInNewContext(jsSnippet, {
      slab: { exitValidity },
      insideRayValid: true,
      metricRaySupported: true,
      exitValidity,
      metricExitPath: 0.4,
      thickness: 0.5,
      geometricPathLength: 0.4,
      opticalLightingMode: 0,
      pixel: [0, 0],
      shadingDepth: 1.0,
      hostTransport: true,
      opticalDebugMode: debugMode,
      entryWorldPosition: [0, 0, -1],
      insideWorldRay: [0, 0, -1],
      exitWorldPosition: [0, 0, -1.4],
      outgoingWorldRay: [0, 0, -1],
      OPTICAL_PROVIDER_DEFERRED: 2,
      params: {
        hostFrameControls: { w: cutoff },
        cameraPosition: { xyz: [0, 0, 0] },
      },
      makeNoOpticalQuerySample: () => ({ providerKind: 0, distance: 60 }),
      sampleHostWaterSegment: () => ({ providerKind: 0, distance: 60 }),
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

  // BL-1 regression: an opaque submerged surface inside a long water slab must preserve its short absorption path
  // even when the full water slab would fall below transmissionMinContribution.
  const subStart = webgpuSource.indexOf('  let geometricPathKnown =');
  const subEnd = webgpuSource.indexOf('  let calibratedAbsorptionCoefficient =', subStart);
  assert.ok(subStart > 0 && subEnd > subStart, 'fs_refraction submerged-surface and absorptionPath block must exist');
  const fullCutoffBlock = webgpuSource.slice(start, subEnd);
  const fullJsBlock = fullCutoffBlock
    .replace(/\bvar\s+/g, 'let ')
    .replace(/vec3<f32>/g, 'vec3')
    .replace(/vec2<f32>/g, 'vec2')
    .replace('params.cameraPosition.xyz - prelimWorldPos', 'subVec(params.cameraPosition.xyz, prelimWorldPos)')
    .replace('-liquidCameraDirection(pixel)', 'negVec(liquidCameraDirection(pixel))')
    .replace('-select(', 'scaleVec(select(')
    .replace(') * prelimSlabPath', '), -prelimSlabPath)')
    .replace('exitWorldPosition + outgoingWorldRay * 0.035', '[0, 0, 0]')
    .replace('refractSceneOffset', '0')
    .replace('sceneUv + offsetPixels / dimsFloat', '[0.5, 0.5]')
    .replace(/: f32/g, '') + '\n({ waterPath, absorptionPath, submergedSurface, queryValidity, transmissionRayActive });';

  function evalSubmergedSlab({ cutoff = 0.25, fullSlabPath = 10.0, submergedDistance = 0.1 }) {
    let mutableVars = {};
    // Convert let declarations that get reassigned (`queryValidity`, `waterPath`, `queryOrigin`, `queryDirection`, `submergedSurface`, `refractionQuery`, `absorptionPath`, `transmissionContribution`, `transmissionRayActive`) back to `var`
    const runnable = fullJsBlock.replace(
      /\blet\s+(queryValidity|waterPath|queryOrigin|queryDirection|submergedSurface|refractionQuery|absorptionPath|prelimSlabPath|prelimAbsorption|transmissionContribution|transmissionRayActive)\b/g,
      'var $1',
    );
    return vm.runInNewContext(runnable, {
      slab: { exitValidity: 1.0 },
      insideRayValid: true,
      metricRaySupported: true,
      exitValidity: 1.0,
      metricExitPath: fullSlabPath,
      geometricPathLength: fullSlabPath,
      thickness: fullSlabPath,
      opticalLightingMode: 0,
      pixel: [0, 0],
      shadingDepth: 1.0,
      hostTransport: true,
      opticalDebugMode: 0,
      entryWorldPosition: [0, 0, -1],
      insideWorldRay: [0, 0, -1],
      exitWorldPosition: [0, 0, -11],
      outgoingWorldRay: [0, 0, -1],
      OPTICAL_PROVIDER_DEFERRED: 2,
      interfaceNormal: { denseBodyConfidence: 1.0 },
      exitRayAngularVariance: 0.2,
      transmissionFootprintMode: 1,
      entryOnlyOffset: [0, 0],
      twoInterfaceOffset: [0, 0],
      dimsFloat: [100, 100],
      sceneUv: [0.5, 0.5],
      refractionSceneColor: {},
      refractionSceneSampler: {},
      bodyTransportMode: 1,
      params: {
        hostFrameControls: { w: cutoff },
        cameraPosition: { xyz: [0, 0, 0] },
      },
      makeNoOpticalQuerySample: () => ({ providerKind: 0, distance: 60 }),
      sampleHostWaterSegment: () => ({
        providerKind: 2,
        distance: submergedDistance,
        radiance: [0.9, 0.8, 0.7],
      }),
      sampleHybridOpticalQuery: () => {
        throw new Error('outgoing query must not run on submerged hit');
      },
      textureSampleLevel: () => ({ rgb: [0.1, 0.1, 0.1] }),
      select: (a, b, cond) => (cond ? b : a),
      clamp: (v, lo, hi) => (Array.isArray(v) ? v : Math.max(lo, Math.min(hi, v))),
      mix: (a, b, t) => (Array.isArray(a) ? a : a * (1 - t) + b * t),
      smoothstep: (e0, e1, x) => {
        const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      },
      max: Math.max,
      pow: Math.pow,
      dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
      exp: v => ({
        r: Math.exp(v[0]),
        g: Math.exp(v[1]),
        b: Math.exp(v[2]),
      }),
      vec2: (x, y = x) => [x, y],
      vec3: (x, y = x, z = x) => [x, y, z],
      subVec: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
      negVec: a => [-a[0], -a[1], -a[2]],
      scaleVec: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
      coherentSlabDepth: () => 1.0,
      reconstructWorldPosition: () => [0, 0, -1],
      liquidCameraDirection: () => [0, 0, -1],
      normalize: v => v,
      reconstructWorldReflectionNormal: () => [0, 0, 1],
    });
  }

  const submergedWithCutoff = evalSubmergedSlab({ cutoff: 0.25, fullSlabPath: 10.0, submergedDistance: 0.1 });
  const submergedNoCutoff = evalSubmergedSlab({ cutoff: 0.0, fullSlabPath: 10.0, submergedDistance: 0.1 });
  assert.equal(submergedWithCutoff.submergedSurface, true, 'BL-1: shallow submerged surface inside thick water slab must still be detected');
  assert.ok(Math.abs(submergedWithCutoff.waterPath - 0.1) < 1e-6, 'BL-1: waterPath must shorten to submerged surface distance (0.1)');
  assert.ok(Math.abs(submergedWithCutoff.absorptionPath - submergedNoCutoff.absorptionPath) < 1e-6, 'BL-1: cutoff must preserve short absorptionPath for strongly contributing submerged surface');
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

  // BL-2 & BL-R2-3 regression: moving an opaque surface toward the front water interface must make attenuation and scatter
  // approach the zero-path limit even when thick water exists behind the opaque surface, and oblique planar segments must
  // use refracted metric path length rather than axial view-Z difference.
  const mlsSource = fs.readFileSync(new URL('../mls-juice-renderer.mjs', import.meta.url), 'utf8');
  const mlsSlabStart = mlsSource.indexOf('  let rawExitDepth=textureLoad(backTex,p,0).x;');
  const mlsSlabEnd = mlsSource.indexOf('  let entryOffset=', mlsSlabStart);
  assert.ok(mlsSlabStart > 0 && mlsSlabEnd > mlsSlabStart, 'MLS compose slab-path block must exist');
  const mlsSlabBlock = mlsSource
    .slice(mlsSlabStart, mlsSlabEnd)
    .replace('let rawExitDepth=textureLoad(backTex,p,0).x;', '')
    .replace('let viewDir=normalize(eye(uv,depth));let view=-viewDir;', 'let view=negVec(viewDir);')
    .replace(/insideRay\.z/g, 'insideRay[2]')
    .replace('exp(-vec3f(1.10,0.42,0.18)*absorptionPath)', 'expVec(scaleVec([1.10,0.42,0.18], -absorptionPath))') +
    '\n({ geometricPathLength, metricGeometricPath, absorptionPath, transmissionContribution, submergedOpaque });';

  const refractVec3 = (I, N, eta) => {
    const cosi = -(I[0] * N[0] + I[1] * N[1] + I[2] * N[2]);
    const k = 1 - eta * eta * (1 - cosi * cosi);
    if (k < 0) return [0, 0, 0];
    const f = eta * cosi - Math.sqrt(k);
    return [eta * I[0] + f * N[0], eta * I[1] + f * N[1], eta * I[2] + f * N[2]];
  };

  function evalMlsSlabPath({
    depth = 1.0,
    sceneD = 1.001,
    rawExitDepth = 5.0,
    amount = 1.0,
    denseBodyConfidence = 1.0,
    viewDir = [0, 0, -1],
    transportN = [0, 0, 1],
    macroN = [0, 0, 1],
    cutoff = 0.25,
  }) {
    const out = vm.runInNewContext(mlsSlabBlock, {
      depth,
      sceneD,
      rawExitDepth,
      amount,
      denseBodyConfidence,
      viewDir,
      transportN,
      macroN,
      camera: { optics: { x: cutoff } },
      refract: refractVec3,
      negVec: v => [-v[0], -v[1], -v[2]],
      scaleVec: (v, s) => v.map(x => x * s),
      expVec: v => ({ r: Math.exp(v[0]), g: Math.exp(v[1]), b: Math.exp(v[2]) }),
      dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
      pow: Math.pow,
      abs: Math.abs,
      clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
      max: Math.max,
      min: Math.min,
      mix: (a, b, t) => a * (1 - t) + b * t,
      select: (a, b, cond) => (cond ? b : a),
    });
    const absorption = [1.10, 0.42, 0.18].map(k => Math.exp(-k * out.absorptionPath));
    const scatter = [0.055, 0.30, 0.42].map((c, i) => c * (1 - absorption[i]));
    return { ...out, absorption, scatter };
  }

  const nearOpaque = evalMlsSlabPath({ depth: 1.0, sceneD: 1.0001, rawExitDepth: 5.0, amount: 1.0, denseBodyConfidence: 1.0 });
  assert.ok(
    nearOpaque.absorptionPath <= 0.0001 + 1e-9,
    `BL-2: absorptionPath (${nearOpaque.absorptionPath}) must remain bounded by visible water segment before opaque sceneD`,
  );
  assert.ok(
    nearOpaque.absorption.every(c => c > 0.9998),
    `BL-2: absorption (${nearOpaque.absorption.join(', ')}) must approach 1 as opaque surface approaches front interface`,
  );
  assert.ok(
    nearOpaque.scatter.every(s => s < 1e-4),
    `BL-2: scatter (${nearOpaque.scatter.join(', ')}) must approach 0 as opaque surface approaches front interface`,
  );

  // BL-3, BL-R2-1, BL-R2-2 regression: parallel entry and exit interfaces must preserve expected negative lateral
  // displacement across camera distances without reversing sign, and submerged opaque surfaces must sample at the
  // projected inside-ray hit without hidden back-surface exit refraction.
  const mlsRefractStart = mlsSource.indexOf('  if(transmissionContribution >= transmissionMinContribution){');
  const mlsRefractEnd = mlsSource.indexOf('    let coneRadius=', mlsRefractStart);
  assert.ok(mlsRefractStart > 0 && mlsRefractEnd > mlsRefractStart, 'MLS compose two-interface refraction block must exist');
  const mlsRefractBlock = mlsSource.slice(
    mlsRefractStart + '  if(transmissionContribution >= transmissionMinContribution){\n'.length,
    mlsRefractEnd,
  );

  function evalParallelInterfaceShift({
    viewDir,
    depth = 1.0,
    geometricPathLength = 0.4,
    rawExitDepth = depth + geometricPathLength,
    sceneD = depth + geometricPathLength + 1.0,
    tiltedBackNormal = [0, 0, -1],
  }) {
    const transportN = [0, 0, 1];
    const insideRay = refractVec3(viewDir, transportN, 1.0 / 1.333);
    const metricScale = 1.0 / Math.max(Math.abs(insideRay[2]), 0.25);
    const metricGeometricPath = geometricPathLength * metricScale;
    const slabExitDepth = Math.max(rawExitDepth, depth + geometricPathLength * 0.35);
    const submergedOpaque = sceneD < slabExitDepth;
    const waterExitDepth = Math.min(slabExitDepth, sceneD);
    const colorSize = [320, 200];
    const size = [320, 200];
    const entryEye = [viewDir[0] / -viewDir[2] * depth, viewDir[1] / -viewDir[2] * depth, -depth];
    const projectPoint = v => {
      const w = -v[2];
      return [v[0], v[1], v[2], w];
    };
    const entryClip = projectPoint(entryEye);
    const uv = [entryClip[0] / entryClip[3] * 0.5 + 0.5, 0.5 - entryClip[1] / entryClip[3] * 0.5];
    const pixel = [uv[0] * colorSize[0], uv[1] * colorSize[1]];

    const jsRefract = mlsRefractBlock
      .replace(/vec2f\(([^()]+),([^()]+)\)/g, '[$1, $2]')
      .replace(/vec2f\(([^()]+)\)/g, 'toVec2($1)')
      .replace(/vec2i\(([^()]+),([^()]+)\)/g, '[$1, $2]')
      .replace(/vec2i\(([^()]+)\)/g, 'toVec2i($1)')
      .replace('eye(uv,depth)+insideRay*metricGeometricPath', 'addVec(eye(uv,depth), scaleVec(insideRay, metricGeometricPath))')
      .replace('camera.projection*vec4f(exitPosView,1.)', 'projectPoint(exitPosView)')
      .replace('camera.projection*vec4f(postExitPosView,1.)', 'projectPoint(postExitPosView)')
      .replace(/exitClip\.x/g, 'exitClip[0]')
      .replace(/exitClip\.y/g, 'exitClip[1]')
      .replace(/exitClip\.w/g, 'exitClip[3]')
      .replace(/postClip\.x/g, 'postClip[0]')
      .replace(/postClip\.y/g, 'postClip[1]')
      .replace(/postClip\.w/g, 'postClip[3]')
      .replace('exitPosView+outgoingRay*(postExitDepthSpan/max(abs(outgoingRay.z),.25))', 'addVec(exitPosView, scaleVec(outgoingRay, postExitDepthSpan / Math.max(Math.abs(outgoingRay[2]), 0.25)))')
      .replace(/outgoingRay\.z/g, 'outgoingRay[2]')
      .replace('exitUv*toVec2(size)', '[exitUv[0]*size[0], exitUv[1]*size[1]]')
      .replace('targetUv*toVec2(colorSize)-toVec2(pixel)', '[targetUv[0]*colorSize[0]-pixel[0], targetUv[1]*colorSize[1]-pixel[1]]')
      .replace('backPoint(exitP+[1, 0],exitCenter)-backPoint(exitP-[1, 0],exitCenter)', '[1, 0, 0]')
      .replace('backPoint(exitP+[0, 1],exitCenter)-backPoint(exitP-[0, 1],exitCenter)', '[0, 1, 0]')
      .replace('if(exitN.z>0.){exitN=-exitN;}', 'exitN = tiltedBackNormal;')
      .replace('refract(insideRay,-exitN,1.333)', 'refractVec3(insideRay, negVec(exitN), 1.333)')
      .replace('toVec2(pixel)+mix(entryOffset,twoInterfaceDelta,select(0.,1.,rawExitDepth>depth))', 'addVec2(pixel, mixVec2(entryOffset, twoInterfaceDelta, rawExitDepth > depth ? 1 : 0))');

    return vm.runInNewContext(jsRefract + '\n({ baseRefractPixel, pixel, targetUv, exitUv });', {
      uv,
      depth,
      sceneD,
      waterExitDepth,
      submergedOpaque,
      geometricPathLength,
      metricGeometricPath,
      amount: geometricPathLength,
      absorptionPath: metricGeometricPath,
      rawExitDepth,
      insideRay,
      viewDir,
      pixel,
      size,
      colorSize,
      entryOffset: [0, 0],
      tiltedBackNormal,
      backTex: {},
      eye: () => entryEye,
      projectPoint,
      refractVec3,
      negVec: v => [-v[0], -v[1], -v[2]],
      textureLoad: () => ({ x: rawExitDepth }),
      normalize: v => v,
      cross: () => tiltedBackNormal,
      length: v => Math.hypot(...v),
      abs: Math.abs,
      max: Math.max,
      min: Math.min,
      clamp: (v, lo, hi) => (Array.isArray(v) ? v.map((x, i) => Math.max(lo[i], Math.min(hi[i], x))) : Math.max(lo, Math.min(hi, v))),
      select: (a, b, c) => (c ? b : a),
      mix: (a, b, t) => (Array.isArray(a) ? a.map((x, i) => x * (1 - t) + b[i] * t) : a * (1 - t) + b * t),
      mixVec2: (a, b, t) => [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t],
      toVec2: v => (Array.isArray(v) ? [v[0], v[1]] : [v, v]),
      toVec2i: v => (Array.isArray(v) ? [Math.trunc(v[0]), Math.trunc(v[1])] : [Math.trunc(v), Math.trunc(v)]),
      vec2i: (x, y = x) => (Array.isArray(x) ? [Math.trunc(x[0]), Math.trunc(x[1])] : [Math.trunc(x), Math.trunc(y)]),
      vec2f: (x, y = x) => (Array.isArray(x) ? [x[0], x[1]] : [x, y]),
      addVec: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
      addVec2: (a, b) => [a[0] + b[0], a[1] + b[1]],
      subVec2: (a, b) => [a[0] - b[0], a[1] - b[1]],
      mulVec2: (a, b) => [a[0] * b[0], a[1] * b[1]],
      divVec2: (a, s) => [a[0] / s, a[1] / s],
      scaleVec: (a, s) => a.map(x => x * s),
    });
  }

  const obliqueShiftNear = evalParallelInterfaceShift({ viewDir: [0.6, 0, -0.8], depth: 1.0, geometricPathLength: 0.4 });
  const obliqueShiftFar = evalParallelInterfaceShift({ viewDir: [0.6, 0, -0.8], depth: 10.0, geometricPathLength: 0.4 });
  const normalShift = evalParallelInterfaceShift({ viewDir: [0, 0, -1.0], depth: 1.0, geometricPathLength: 0.4 });
  const nearDeltaX = obliqueShiftNear.baseRefractPixel[0] - obliqueShiftNear.pixel[0];
  const farDeltaX = obliqueShiftFar.baseRefractPixel[0] - obliqueShiftFar.pixel[0];
  assert.ok(
    nearDeltaX < -1.0,
    `BL-3 / BL-R2-2: oblique ray through parallel slab at depth 1 must shift negatively (got ${nearDeltaX})`,
  );
  assert.ok(
    farDeltaX < -0.1 && Math.abs(farDeltaX) < Math.abs(nearDeltaX),
    `BL-R2-2: oblique ray through parallel slab at depth 10 must keep negative sign and smaller magnitude than depth 1 (got near=${nearDeltaX}, far=${farDeltaX})`,
  );
  assert.ok(
    Math.hypot(normalShift.baseRefractPixel[0] - normalShift.pixel[0], normalShift.baseRefractPixel[1] - normalShift.pixel[1]) < 1e-5,
    'BL-3: normal-incidence ray through parallel slab interfaces must produce zero lateral displacement',
  );

  // BL-R2-3 regression: Beer-Lambert attenuation and transmissionContribution must use metric distance along insideRay
  // rather than axial view-Z difference.
  const obliquePlanarMetric = evalMlsSlabPath({
    depth: 1.0,
    sceneD: 1.4,
    rawExitDepth: 5.0,
    amount: 0.4,
    denseBodyConfidence: 0.0,
    viewDir: [0.6, 0, -0.8],
    transportN: [0, 0, 1],
    macroN: [0, 0, 1],
    cutoff: 0.907,
  });
  assert.ok(
    Math.abs(obliquePlanarMetric.absorptionPath - 0.447942456) < 1e-4,
    `BL-R2-3: oblique planar segment must use refracted metric path ~0.447942 rather than axial 0.4 (got ${obliquePlanarMetric.absorptionPath})`,
  );
  assert.equal(
    obliquePlanarMetric.transmissionContribution < 0.907,
    true,
    `BL-R2-3: metric contribution (${obliquePlanarMetric.transmissionContribution}) at cutoff 0.907 must fall below threshold`,
  );

  // BL-R2-1 regression: a submerged opaque surface inside the water slab (sceneD < slabExitDepth) must sample at the
  // projected inside-ray hit without applying water-to-air exit refraction from the hidden back surface behind it.
  const submergedShift = evalParallelInterfaceShift({
    viewDir: [0.6, 0, -0.8],
    depth: 1.0,
    geometricPathLength: 0.4,
    rawExitDepth: 5.0,
    sceneD: 1.4,
    tiltedBackNormal: [0.35, 0, -0.9367497],
  });
  const expectedSubmergedHitX = 268.757087;
  assert.ok(
    Math.abs(submergedShift.baseRefractPixel[0] - expectedSubmergedHitX) < 1e-3,
    `BL-R2-1: submerged opaque plane must sample at projected inside-ray hit ${expectedSubmergedHitX} without hidden back-surface exit deflection (got ${submergedShift.baseRefractPixel[0]})`,
  );
}

console.log('All transmission cutoff, persistence, inspector, and MLS optical slab renderer tests passed');
