import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as volumeCore from '../volume-core.js';
import * as emitterBasis from '../volume-emitter-basis.mjs';
import { applyVolumeEmitterFamilyRuntime } from '../volume-emitter-runtime.mjs';

const root = new URL('../', import.meta.url);
const coreSource = readFileSync(new URL('volume-core.js', root), 'utf8');
const cockpitSource = readFileSync(new URL('index.html', root), 'utf8');
const settingsSchema = JSON.parse(readFileSync(new URL('volume-settings-preset-schema-v2.json', root), 'utf8'));
const injectionShader = coreSource.match(
  /const ANALYTIC_EMITTER_INJECTION_WGSL = \/\* wgsl \*\/[\s\S]*?\n`;/,
)?.[0] || '';

assert.deepEqual(
  emitterBasis.VOLUME_EMITTER_INLET_PROFILES,
  ['plug', 'resolved-shear', 'edge-entrained'],
  'the assay exposes the current plug inlet and exactly two source-local shaped arms',
);

const common = {
  family: 'ribbon',
  origin: [0, -0.76, 0],
  direction: [0, 1, 0],
  supportAxis: [1, 0, 0],
  radius: 0.046,
  length: 0.506,
  strength: 0.5,
  velocitySpeed: 0.22,
  transportSpeed: 5,
  sourceLaw: 'shallow-primary',
  sourceDepth: 0.04,
  frameId: 'inlet-boundary-profile-contract',
};

const predecessor = emitterBasis.compileVolumeEmitterFamily(common);
assert.equal(predecessor.descriptor.inletProfile, 'plug', 'existing callers remain on the plug inlet');
assert.equal(predecessor.descriptor.momentumLinked, true, 'existing callers retain flow-linked momentum');
assert.ok(
  Math.abs(predecessor.descriptor.effectiveInletVelocity - 0.0396) < 1e-12,
  'plug + linked momentum reproduces 0.22 * 0.5 * (0.18 + 5 * 0.036)',
);

const independentLowFlow = emitterBasis.compileVolumeEmitterFamily({
  ...common,
  strength: 0.2,
  momentumLinked: false,
  inletVelocity: 0.0375,
  inletProfile: 'resolved-shear',
  shearWidthCells: 3,
});
const independentHighFlow = emitterBasis.compileVolumeEmitterFamily({
  ...common,
  strength: 1.8,
  momentumLinked: false,
  inletVelocity: 0.0375,
  inletProfile: 'resolved-shear',
  shearWidthCells: 3,
});
assert.equal(independentLowFlow.descriptor.effectiveInletVelocity, 0.0375);
assert.equal(
  independentHighFlow.descriptor.effectiveInletVelocity,
  independentLowFlow.descriptor.effectiveInletVelocity,
  'independent inlet velocity does not change when chemical throughput changes',
);
assert.notEqual(
  independentHighFlow.descriptor.strength,
  independentLowFlow.descriptor.strength,
  'chemical throughput remains independently controllable',
);

const boundary = emitterBasis.resolveVolumeEmitterInletProfileWeights({
  profile: 'resolved-shear',
  apertureSignedDistance: 0,
  inletSupport: 1,
  cellWidth: 2 / 160,
  shearWidthCells: 3,
});
const interior = emitterBasis.resolveVolumeEmitterInletProfileWeights({
  profile: 'resolved-shear',
  apertureSignedDistance: -3 * (2 / 160),
  inletSupport: 1,
  cellWidth: 2 / 160,
  shearWidthCells: 3,
});
assert.equal(boundary.axialWeight, 0, 'resolved shear has zero axial injection at the aperture wall');
assert.equal(interior.axialWeight, 1, 'resolved shear reaches full axial injection after its explicit cell band');

const entrainedBoundary = emitterBasis.resolveVolumeEmitterInletProfileWeights({
  profile: 'edge-entrained',
  apertureSignedDistance: 0,
  inletSupport: 1,
  cellWidth: 2 / 160,
  shearWidthCells: 3,
});
const entrainedFarField = emitterBasis.resolveVolumeEmitterInletProfileWeights({
  profile: 'edge-entrained',
  apertureSignedDistance: 4 * (2 / 160),
  inletSupport: 1,
  cellWidth: 2 / 160,
  shearWidthCells: 3,
});
assert.equal(entrainedBoundary.edgeWeight, 1, 'edge entrainment is concentrated at the analytic perimeter');
assert.equal(entrainedFarField.edgeWeight, 0, 'edge entrainment has bounded support');

assert.throws(
  () => emitterBasis.compileVolumeEmitterFamily({ ...common, inletProfile: 'global-curl-noise' }),
  /unsupported emitter inlet profile: global-curl-noise/,
);

assert.match(injectionShader, /fn apertureSignedDistance\(/, 'the shader owns an analytic aperture boundary distinct from volume support');
assert.match(injectionShader, /let inletDepthSupport = 1\.0 - smoothstep\(-0\.5 \* cellWidth, 0\.5 \* cellWidth, inletSignedDistance\);[\s\S]*?if \(sourceLaw >= 0\.5\)/, 'shaped momentum remains confined to the inlet depth even when legacy chemistry support is selected');
assert.match(injectionShader, /let chemistryWeight = chemicalSupport \* max\(0\.0, emitter\.axis_strength\.w\);/, 'chemistry remains controlled by source strength');
assert.match(injectionShader, /let linkedInletVelocity = emitter\.geometry\.y \* emitter\.axis_strength\.w \* \(0\.18 \+ emitter\.transport\.x \* 0\.036\);/, 'the linked arm preserves the predecessor momentum equation');
assert.match(injectionShader, /let effectiveInletVelocity = select\(emitter\.inlet_controls\.z, linkedInletVelocity, emitter\.inlet_controls\.y < 0\.5\);/, 'the independent arm bypasses chemical strength and global transport speed');
assert.match(injectionShader, /let transportedAxialSpeed = max\(0\.0, dot\(previousVelocityDensity\.xyz, axis\)\);/, 'edge entrainment responds to transported same-cell state');
assert.match(injectionShader, /entrainmentVelocity = -apertureNormal \* transportedAxialSpeed \* edgeWeight \* max\(0\.0, emitter\.transport\.w\);/, 'edge entrainment points inward along the analytic source normal');
assert.doesNotMatch(injectionShader, /sin\(|cos\(|hash|random/i, 'the inlet-profile pass contains no periodic or random forcing');
assert.doesNotMatch(injectionShader, /fluid\[(?!base(?: \+ [123]u)?\])/, 'the inlet-profile pass does not read neighboring fluid cells');
assert.match(coreSource, /new ArrayBuffer\(36 \* Float32Array\.BYTES_PER_ELEMENT\)/, 'the expanded analytic emitter uniform owns nine aligned vec4 slots');
assert.match(coreSource, /floats\[23\] = descriptor\.edgeEntrainment;[\s\S]*?floats\[24\] = ANALYTIC_EMITTER_INLET_PROFILE_MODE\[descriptor\.inletProfile\][\s\S]*?floats\[25\] = descriptor\.momentumLinked \? 0 : 1;[\s\S]*?floats\[26\] = descriptor\.inletVelocity;[\s\S]*?floats\[27\] = descriptor\.shearWidthCells;[\s\S]*?words\.set\(\[\.\.\.dispatch\.cellMin, dispatch\.grid\], 28\);[\s\S]*?words\.set\(\[\.\.\.dispatch\.cellExtent, 0\], 32\);/, 'CPU uniform packing exactly matches the inlet-controls and dispatch vec4 boundaries');
assert.match(injectionShader, /transport: vec4<f32>,\s+inlet_controls: vec4<f32>,\s+cell_min_grid: vec4<u32>,\s+cell_extent: vec4<u32>,/, 'WGSL reads the same aligned uniform layout written by JavaScript');

const edgeDispatch = volumeCore.analyticEmitterInjectionDispatch(emitterBasis.compileVolumeEmitterFamily({
  ...common,
  inletProfile: 'edge-entrained',
  shearWidthCells: 3,
  edgeEntrainment: 0.65,
}).descriptor, 160);
const plugDispatch = volumeCore.analyticEmitterInjectionDispatch(predecessor.descriptor, 160);
assert.ok(edgeDispatch.cellCount > plugDispatch.cellCount, 'edge entrainment expands only the bounded source dispatch enough to include its perimeter band');

const calls = [];
const prototype = {
  setControls(controls) { calls.push(['controls', controls]); },
  setCoreEmitterSourceMode(mode) {
    return { requestedMode: mode, effectiveMode: mode, effectiveFlowRate: mode === 'cluster' ? 0.5 : 0 };
  },
  setAnalyticEmitterDescriptor(descriptor) {
    calls.push(['analytic', descriptor]);
    return descriptor
      ? {
          mode: 'analytic-fixed',
          family: descriptor.family,
          sourceLaw: descriptor.sourceLaw,
          sourceDepth: descriptor.sourceDepth,
          inletProfile: descriptor.inletProfile,
          momentumLinked: descriptor.momentumLinked,
          inletVelocity: descriptor.inletVelocity,
          effectiveInletVelocity: descriptor.effectiveInletVelocity,
          shearWidthCells: descriptor.shearWidthCells,
          edgeEntrainment: descriptor.edgeEntrainment,
          count: 1,
          coordinateSpace: 'volume-local',
        }
      : { mode: 'off', family: 'cluster', count: 0, coordinateSpace: 'none' };
  },
  setExternalEmitters(request) {
    return { mode: request.mode, count: request.emitters.length, coordinateSpace: 'none', frameId: request.frameId };
  },
};
const runtime = applyVolumeEmitterFamilyRuntime({
  prototype,
  family: 'ribbon',
  controls: {
    inputRadius: 0.23,
    flowRate: 0.5,
    speed: 5,
    emitterSourceLaw: 'shallow-primary',
    emitterSourceDepth: 0.04,
    emitterInletProfile: 'edge-entrained',
    emitterMomentumLinked: false,
    emitterInletVelocity: 0.0375,
    emitterShearWidthCells: 3,
    emitterEdgeEntrainment: 0.65,
  },
});
for (const key of ['inletProfile', 'momentumLinked', 'inletVelocity', 'effectiveInletVelocity', 'shearWidthCells', 'edgeEntrainment']) {
  assert.equal(runtime.effective[key], calls.find(([kind]) => kind === 'analytic')[1][key], `runtime receipt preserves effective ${key}`);
}

const expectedControls = [
  ['volume-emitter-inlet-profile', 'volume_emitter_inlet_profile', 'SELECT', 'select-one', 'plug'],
  ['volume-emitter-momentum-linked', 'volume_emitter_momentum_linked', 'INPUT', 'checkbox', true],
  ['volume-emitter-inlet-velocity', 'volume_emitter_inlet_velocity', 'INPUT', 'range', 0.04],
  ['volume-emitter-shear-width', 'volume_emitter_shear_width_cells', 'INPUT', 'range', 3],
  ['volume-emitter-edge-entrainment', 'volume_emitter_edge_entrainment', 'INPUT', 'range', 0.65],
];
for (const [key, param, tagName, type, additiveDefault] of expectedControls) {
  assert.deepEqual(settingsSchema.controls.find(control => control.key === key), {
    key,
    param,
    tagName,
    type,
    additiveDefault,
  });
}
assert.equal(settingsSchema.controlCount, settingsSchema.controls.length);

assert.match(cockpitSource, /id="volume-emitter-inlet-profile"[^>]+data-volume-settings-param="volume_emitter_inlet_profile"/);
assert.match(cockpitSource, /id="volume-emitter-momentum-linked"[^>]+data-volume-settings-param="volume_emitter_momentum_linked"/);
assert.match(cockpitSource, /id="volume-emitter-inlet-velocity"[^>]+data-volume-settings-param="volume_emitter_inlet_velocity"/);
assert.match(cockpitSource, /id="volume-emitter-shear-width"[^>]+data-volume-settings-param="volume_emitter_shear_width_cells"/);
assert.match(cockpitSource, /id="volume-emitter-edge-entrainment"[^>]+data-volume-settings-param="volume_emitter_edge_entrainment"/);
assert.match(cockpitSource, /Inlet Δv \(field\/step\)/, 'the direct velocity control marks its solver unit without explanatory prose');
assert.match(cockpitSource, /Shear width \(cells\)/, 'the spatial width is labeled in grid cells');
assert.match(cockpitSource, /Edge entrainment \(×\)/, 'the entrainment response is labeled as a multiplier');
assert.match(cockpitSource, /if \(event\?\.target\?\.id === 'volume-emitter-momentum-linked'[\s\S]*?\.checked === false\)[\s\S]*?volume-emitter-inlet-velocity[\s\S]*?linkedVolumeEmitterInletVelocity/, 'unlinking initializes the independent value from the currently effective linked inlet velocity');

console.log('volume inlet boundary profile contracts passed');
