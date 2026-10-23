import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RAY_START_WGSL } from '../volume-ray-start.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const cockpit = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const initialTabActivation = cockpit.indexOf("if (isKaminosVolumeSmokeRoute(initialViewerParams)) setActiveTab('volume');");
assert.ok(initialTabActivation >= 0, 'volume routes select the volume tab at startup');
for (const declaration of ['let fingerFluidBenchRunning = false;', 'let fingerFluidBenchAnimationFrame = null;']) {
  const initialization = cockpit.indexOf(declaration);
  assert.ok(initialization >= 0 && initialization < initialTabActivation,
    `initial tab activation must follow ${declaration}: switching tabs stops the liquid bench`);
}
const binding = name => {
  const match = core.match(new RegExp('@group\\((\\d+)\\) @binding\\((\\d+)\\) var<storage, [^>]+> ' + name + ':'));
  assert.ok(match, `GPU binding exists for ${name}`);
  return `${match[1]}:${match[2]}`;
};
const names = ['quenchSrc', 'quenchDst', 'nonRidgeOpticalCaptureHeader', 'nonRidgeOpticalCaptureRows'];
assert.equal(new Set(names.map(binding)).size, names.length,
  'quench ping-pong and optical capture must use four distinct GPU bindings');

const helper = core.match(/  function createFluidRenderBindGroup\([\s\S]*?\n  }\n/)?.[0];
assert.ok(helper, 'one shared fluid binding constructor');
const buffer = label => ({ label });
const quenchBuffers = [buffer('quench A'), buffer('quench B')];
const resources = {
  device: { createBindGroup: descriptor => descriptor }, bindGroupLayout: {},
  uniformBuffer: buffer('uniform'), externalEmitterBuffer: buffer('emitter'),
  oracleActivityCueBuffer: buffer('oracle'), boundarySidecarBuffer: buffer('sidecar'),
  nonRidgeOpticalCaptureHeaderBuffer: buffer('capture header'),
  emissiveLightField: { incident: buffer('incident') }, quenchBuffers,
  rayStepTelemetry: {counterBuffer:buffer('ray statistics')},
  sceneSolidTextureView: { label: 'scene solid view' },
  // The inflow aperture coverage map (binding 17) is a texture in the same closure.
  immersedCollectionTexture: { createView: options => ({ label: 'immersed collection view', ...options }) },
  inflowCoverageTexture: { createView: () => ({ label: 'inflow coverage view' }) },
  inflowPerturbationTexture: { createView: () => ({ label: 'inflow perturbation view' }) },
  rayStartNoiseTexture: { createView: () => ({ label: 'stable spatial ray-start noise view' }) },
  burnRateTexture: { createView: () => ({ label: 'burn rate view' }) },
  forceDeltaTexture: { createView: () => ({ label: 'force increment view' }) },
  // The reactant sidecar textures (bindings 23/24) live in the same closure.
  reactantTextures: [{ createView: () => ({ label: 'reactant A view' }) }, { createView: () => ({ label: 'reactant B view' }) }],
  // The wavelet turbulence coordinate textures (bindings 31/32), same closure.
  waveletTextures: [{ createView: () => ({ label: 'wavelet A view' }) }, { createView: () => ({ label: 'wavelet B view' }) }],
  // The joined boundary's lower-plane texture (binding 28), same closure.
  joinedLowerFaceView: () => ({ label: 'joined lower planes view' }),
  joinedGhostView: index => ({ label: `joined ghost view ${index}` }),
};
const makeGroup = new Function(...Object.keys(resources), `${helper}; return createFluidRenderBindGroup;`)(...Object.values(resources));
for (let q = 0; q < 2; q++) {
  const captureRows = buffer(`capture ${q}`);
  const group = makeGroup({ label: 'composition', fluidRead: buffer('fluid'), fluidWrite: buffer('next'),
    frontRead: buffer('front'), frontWrite: buffer('next front'), captureRows,
    quenchRead: quenchBuffers[q], quenchWrite: quenchBuffers[1 - q] });
  const entry = name => group.entries.find(e => e.binding === Number(binding(name).split(':')[1]))?.resource.buffer;
  assert.equal(entry('quenchSrc'), quenchBuffers[q]);
  assert.equal(entry('quenchDst'), quenchBuffers[1 - q]);
  assert.equal(entry('nonRidgeOpticalCaptureRows'), captureRows);
  assert.equal(entry('nonRidgeOpticalCaptureHeader'), resources.nonRidgeOpticalCaptureHeaderBuffer);
  assert.equal(group.entries.find(e => e.binding === 16)?.resource, resources.sceneSolidTextureView);
  assert.deepEqual(group.entries.find(e => e.binding === 33)?.resource, {label:'immersed collection view',dimension:'2d-array'});
  const noiseBinding = Number(RAY_START_WGSL.match(/@binding\((\d+)\) var rayStartNoise:/)?.[1]);
  assert.ok(Number.isInteger(noiseBinding), 'noise texture has a shader binding');
  assert.deepEqual(group.entries.find(e => e.binding === noiseBinding)?.resource,
    resources.rayStartNoiseTexture.createView(), 'the production group binds the spatial ray-start texture');
  assert.equal(new Set(group.entries.map(e => e.binding)).size, group.entries.length,
    'all fluid render resources have distinct bindings');
  assert.equal(group.entries.find(e=>e.binding===26)?.resource.buffer,resources.rayStepTelemetry.counterBuffer);
  assert.equal(group.entries.find(e => e.binding === 28)?.resource.label, 'joined lower planes view');
  for (let g = 0; g < 2; g++) assert.equal(group.entries.find(e => e.binding === 29 + g)?.resource.label, `joined ghost view ${g}`);
}
assert.match(core, /function fluidBindGroup\([\s\S]*?return bindGroups\[fluidIndex \* 2 \+ quenchIndex\]/,
  'simulation consumes both independent ping-pong indices');
assert.doesNotMatch(core, /\bbindGroups\[currentFluid\]/, 'no single-index consumer of four fluid/quench groups');
assert.doesNotMatch(core, /let flowDebug = clamp\(u\.boundary_fire_display\.y/,
  'flow debug must not consume the intrinsic presentation flag');
console.log('PASS: main quench and emissive capture integration contracts');
