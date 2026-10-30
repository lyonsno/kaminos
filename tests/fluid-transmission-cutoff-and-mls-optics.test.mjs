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
    .replace(/vec4<f32>/g, 'vec4')
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
      /\blet\s+(queryValidity|waterPath|queryOrigin|queryDirection|submergedSurface|refractionQuery|refractedScene|absorptionPath|prelimSlabPath|prelimAbsorption|transmissionContribution|transmissionRayActive)\b/g,
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
      vec4: (x, y = x, z = x) => ({ rgb: [x, y, z] }),
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
  let lastPreview = null;
  f.api.read = () => ({ ...read(), simulation });
  f.api.preview = draft => {
    lastPreview = draft;
    return { initialOnly: true, draft: !!draft };
  };
  f.api.editSimulation = patch => {
    lastPatch = patch;
    simulation = { ...simulation, settings: { ...simulation.settings, ...patch } };
  };
  f.controls.refresh();
  assert.equal(Number(f.input('[data-transmission-cutoff]').value), 0.25, 'inspector must display default 0.25 cutoff');
  assert.equal(Number(f.input('[data-transmission-cutoff-range]').value), 0.25, 'range slider must display default 0.25 cutoff');
  f.input('[data-transmission-cutoff]').value = 0.35;
  f.input('[data-transmission-cutoff]').listeners.input();
  assert.equal(Number(f.input('[data-transmission-cutoff-range]').value), 0.35, 'typing in number box must sync range slider');
  await f.controls.flush();
  assert.equal(lastPatch?.transmissionMinContribution, 0.35, 'inspector edit must flush transmissionMinContribution');
  f.controls.refresh();
  assert.equal(Number(f.input('[data-transmission-cutoff]').value), 0.35);

  f.input('[data-transmission-cutoff-range]').value = 0.62;
  f.input('[data-transmission-cutoff-range]').listeners.input();
  assert.equal(Number(f.input('[data-transmission-cutoff]').value), 0.62, 'dragging range slider must sync number box');
  await f.controls.flush();
  assert.equal(lastPatch?.transmissionMinContribution, 0.62, 'range slider edit must flush transmissionMinContribution');

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

// 5. MLS screen-space surface & refraction optical renderer + live transmissionMinContribution cutoff
{
  globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 };
  globalThis.GPUBufferUsage = { UNIFORM: 4, COPY_DST: 8, STORAGE: 128 };
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
    densities: {},
    config: { capacity: 4096, cell: 0.05, min: [-1.6, -0.1, -1.6], particleRadius: 0.0325, restDensity: 4 },
  };
  const renderer = await createMlsJuiceRenderer({
    device,
    solver,
    hostEnvironment: true,
    transmissionMinContribution: 0.25,
  });
  assert.equal(shaderCodes.length, 1);
  const wgsl = shaderCodes[0];
  assert.match(wgsl, /fn vs_accumulate/, 'MLS renderer must include screen-space surface accumulation vertex shader');
  assert.match(wgsl, /fn fs_accumulate/, 'MLS renderer must include screen-space surface accumulation fragment shader');
  assert.match(wgsl, /fn fs_refraction/, 'MLS renderer must include screen-space refraction optical fragment shader');
  assert.match(wgsl, /fn edgePreservingDepth/, 'MLS renderer must use edgePreservingDepth for smooth particle-free surface normals');
  assert.match(wgsl, /fn integrateWorldReflectionQuadrature/, 'MLS renderer must trace host scene & environment reflection quadrature');
  assert.match(wgsl, /fn integrateTransmissionQuadrature/, 'MLS renderer must trace exit transmission quadrature');
  assert.match(wgsl, /fn evaluateBoundedGgxDirectSpecular/, 'MLS renderer must evaluate direct GGX specular highlights');
  assert.match(wgsl, /transmissionContribution >= transmissionMinContribution/, 'MLS renderer must gate transmission on transmissionMinContribution');
  assert.match(
    wgsl,
    /let transmittedTransport = select\(vec3<f32>\(0\.0\), refractedRadiance \* absorption \* \(1\.0 - fresnel\), transmissionRayActive\);/,
    'MLS renderer must cut off transmittedTransport when transmissionRayActive is false',
  );

  assert.equal(renderer.read().transmissionMinContribution, 0.25);
  assert.equal(renderer.read().refractionCutoffEnabled, true);
  assert.equal(renderer.read().renderScale, 1);
  assert.deepEqual(renderer.read().passes, ['surface_accumulation', 'screen_space_refraction_composite']);

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
  assert.equal(renderedPasses.length, 2, 'MLS screen-space refraction renderer must execute 2 passes (MRT accumulation + refraction composite)');
  assert.equal(renderedPasses[0].colorAttachments.length, 3, 'Pass 1 must write 3 MRT attachments (accumulation, frontDepth, backDepth)');
  const lastUniform = uniformWrites.at(-1);
  assert.ok(Math.abs(lastUniform[63] - 0.4) < 1e-6, 'uniform buffer hostFrameControls.w must receive updated transmissionMinContribution (0.4)');
  renderer.dispose();
}

console.log('All transmission cutoff, persistence, inspector, and MLS optical slab renderer tests passed');
