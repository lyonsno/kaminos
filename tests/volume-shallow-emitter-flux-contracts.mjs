import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as volumeCore from '../volume-core.js';
import { compileVolumeEmitterFamily } from '../volume-emitter-basis.mjs';
import { applyVolumeEmitterFamilyRuntime } from '../volume-emitter-runtime.mjs';

const root = new URL('../', import.meta.url);
const coreSource = readFileSync(new URL('volume-core.js', root), 'utf8');
const cockpitSource = readFileSync(new URL('index.html', root), 'utf8');
const settingsSchema = JSON.parse(readFileSync(new URL('volume-settings-preset-schema-v2.json', root), 'utf8'));
const injectionShader = coreSource.match(
  /const ANALYTIC_EMITTER_INJECTION_WGSL = \/\* wgsl \*\/[\s\S]*?\n`;/,
)?.[0] || '';

const common = {
  family: 'nozzle',
  origin: [0, -0.76, 0],
  direction: [0, 1, 0],
  supportAxis: [1, 0, 0],
  radius: 0.08,
  length: 1.2,
  strength: 1,
  velocitySpeed: 0.22,
  frameId: 'shallow-flux-contract',
};

const legacy = compileVolumeEmitterFamily(common);
assert.equal(legacy.descriptor.sourceLaw, 'legacy-volume', 'existing callers retain the filled-volume law explicitly');
assert.equal(legacy.descriptor.compactSupport.interior, 'full');
assert.deepEqual(
  legacy.descriptor.writableFluidComponentIndices,
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15],
  'the legacy receipt names every velocity/material/fire/micro component it can rewrite',
);

const shallow = compileVolumeEmitterFamily({
  ...common,
  sourceLaw: 'shallow-primary',
  sourceDepth: 0.04,
});
assert.equal(shallow.requested.sourceLaw, 'shallow-primary');
assert.equal(shallow.requested.sourceDepth, 0.04);
assert.equal(shallow.effective.sourceLaw, 'shallow-primary');
assert.equal(shallow.effective.sourceDepth, 0.04);
assert.equal(shallow.descriptor.sourceLaw, 'shallow-primary');
assert.equal(shallow.descriptor.sourceDepth, 0.04);
assert.equal(shallow.descriptor.compactSupport.interior, 'shallow-inlet');
assert.deepEqual(
  shallow.descriptor.injectedFields,
  ['velocity', 'smoke', 'heat', 'fuel'],
  'the inlet authors only primary transport/reaction inputs',
);
assert.deepEqual(
  shallow.descriptor.writableFluidComponentIndices,
  [0, 1, 2, 4, 5, 6],
  'the shallow inlet cannot rewrite density carrier or any derived fire/detail component',
);
const sentinelBefore = Array.from({ length: 16 }, (_, index) => 1000 + index);
const sentinelInjected = Array.from({ length: 16 }, (_, index) => 2000 + index);
const applyWritableComponents = descriptor => sentinelBefore.map((value, index) => (
  descriptor.writableFluidComponentIndices.includes(index) ? sentinelInjected[index] : value
));
const shallowSentinelAfter = applyWritableComponents(shallow.descriptor);
assert.deepEqual(
  shallowSentinelAfter.map((value, index) => value !== sentinelBefore[index] ? index : null).filter(index => index !== null),
  [0, 1, 2, 4, 5, 6],
  'a 16-component sentinel proves the shallow law changes exactly velocity xyz, smoke, heat, and fuel',
);
for (const index of [3, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  assert.equal(shallowSentinelAfter[index], sentinelBefore[index], `shallow component ${index} remains byte-for-byte preserved`);
}
assert.throws(
  () => compileVolumeEmitterFamily({ ...common, sourceLaw: 'painted-volume' }),
  /unsupported emitter source law: painted-volume/,
);
assert.throws(
  () => compileVolumeEmitterFamily({ ...common, sourceLaw: 'shallow-primary', sourceDepth: 0 }),
  /sourceDepth 0 must be within/,
);

const legacyDispatch = volumeCore.analyticEmitterInjectionDispatch(legacy.descriptor, 128);
const shallowDispatch = volumeCore.analyticEmitterInjectionDispatch(shallow.descriptor, 128);
assert.ok(shallowDispatch.cellCount < legacyDispatch.cellCount / 4, 'the shallow inlet does not dispatch over the filled nozzle body');
assert.ok(shallowDispatch.cellExtent[1] < legacyDispatch.cellExtent[1] / 4, 'inlet axial work follows source depth, not authored length');

const longerShallow = compileVolumeEmitterFamily({
  ...common,
  length: 1.6,
  sourceLaw: 'shallow-primary',
  sourceDepth: 0.04,
}).descriptor;
assert.deepEqual(
  volumeCore.analyticEmitterInjectionDispatch(longerShallow, 128),
  shallowDispatch,
  'changing downstream support length cannot silently thicken a shallow inlet',
);

assert.match(injectionShader, /let sourceLaw = emitter\.transport\.y;/, 'the GPU consumer receives the source law');
assert.match(injectionShader, /let sourceDepth = max\([^\n]+emitter\.transport\.z\);/, 'the GPU consumer receives source depth');
assert.match(injectionShader, /signedDistance = max\(signedDistance, inletSignedDistance\);/, 'shallow support is the intersection of geometry and inlet depth');
assert.match(injectionShader, /if \(sourceLaw < 0\.5\) \{[\s\S]*?material\.w = max[\s\S]*?fireLayer\.x = max[\s\S]*?microLayer\.w = max[\s\S]*?\}/, 'legacy derived-field painting is isolated behind the legacy law');
assert.match(
  injectionShader,
  /let injectedDensity = select\(velocityDensity\.w, legacyInjectedDensity, sourceLaw < 0\.5\);/,
  'the shallow law preserves the transported density carrier instead of reconstructing it from its new primary inputs',
);
assert.match(coreSource, /let fixedSourceDephase = step\(0\.5, u\.reserved_source_extension_0\.x\);/, 'the fixed-grid source perturbation has an executable ablation gate');
assert.match(coreSource, /let sourceStartupDephase = sourceSpatialDephase \* sourceStartupAuthority \* fixedSourceDephase;/, 'the ordinary source dephase obeys the ablation gate');
assert.match(coreSource, /let startupDephase = staticDephase \* startupAuthority \* fixedSourceDephase;/, 'the Bonfire fixed-grid dephase obeys the same ablation gate');

const calls = [];
const prototype = {
  setControls(controls) { calls.push(['controls', controls]); },
  setCoreEmitterSourceMode(mode) {
    calls.push(['core', mode]);
    return { requestedMode: mode, effectiveMode: mode, effectiveFlowRate: mode === 'cluster' ? 0.2 : 0 };
  },
  setAnalyticEmitterDescriptor(descriptor) {
    calls.push(['analytic', descriptor]);
    return descriptor
      ? {
          mode: 'analytic-fixed',
          family: descriptor.family,
          sourceLaw: descriptor.sourceLaw,
          sourceDepth: descriptor.sourceDepth,
          count: 1,
          coordinateSpace: 'volume-local',
        }
      : { mode: 'off', family: 'cluster', sourceLaw: 'legacy-volume', sourceDepth: 0.04, count: 0, coordinateSpace: 'none' };
  },
  setExternalEmitters(request) {
    calls.push(['external', request]);
    return { mode: request.mode, count: request.emitters.length, coordinateSpace: request.emitters.length ? 'volume-local' : 'none', frameId: request.frameId };
  },
};
const runtimeReceipt = applyVolumeEmitterFamilyRuntime({
  prototype,
  family: 'nozzle',
  controls: {
    inputRadius: 0.5,
    flowRate: 0.8,
    emitterSourceLaw: 'shallow-primary',
    emitterSourceDepth: 0.04,
  },
  frameId: 'runtime-shallow-flux',
});
assert.equal(runtimeReceipt.requested.sourceLaw, 'shallow-primary');
assert.equal(runtimeReceipt.requested.sourceDepth, 0.04);
assert.equal(runtimeReceipt.effective.sourceLaw, 'shallow-primary');
assert.equal(runtimeReceipt.effective.sourceDepth, 0.04);
assert.equal(calls.find(([kind]) => kind === 'analytic')[1].sourceLaw, 'shallow-primary');

const inactiveReceipt = applyVolumeEmitterFamilyRuntime({
  prototype,
  family: 'cluster',
  controls: {
    inputRadius: 0.5,
    flowRate: 0.8,
    emitterSourceLaw: 'shallow-primary',
    emitterSourceDepth: 0.04,
  },
  frameId: 'runtime-inactive-flux',
});
assert.equal(inactiveReceipt.effective.sourceLaw, 'inactive', 'cluster mode cannot imply an analytic source law ran');
assert.equal(inactiveReceipt.effective.sourceDepth, null, 'cluster mode cannot report an effective analytic inlet depth');

const analyticReceiptSource = coreSource.match(/function analyticEmitterReceipt\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
assert.match(analyticReceiptSource, /requestedSourceLaw:/, 'the core analytic receipt preserves the requested law separately');
assert.match(analyticReceiptSource, /requestedSourceDepth:/, 'the core analytic receipt preserves the requested depth separately');
assert.match(analyticReceiptSource, /sourceLaw: analyticEmitterDescriptor \?[^\n]+: 'inactive'/, 'an inactive analytic source cannot report a legacy law as effective');
assert.match(analyticReceiptSource, /sourceDepth: analyticEmitterDescriptor \?[^\n]+: null/, 'an inactive analytic source cannot report a numerical effective depth');

const syncControlsSource = cockpitSource.match(/const syncControls = event => \{[\s\S]*?\n  \};/)?.[0] || '';
assert.match(
  syncControlsSource,
  /if \(emitterMorphologyControls\.has\(event\?\.target\?\.id\)\) \{\s*applyVolumeEmitterFamilyRuntimeToCockpit\(controlsSnapshot\);/,
  'source-law and source-depth edits recompose the receipt even while Cluster is the effective source',
);

assert.match(cockpitSource, /id="volume-emitter-source-law"[^>]+data-volume-settings-param="volume_emitter_source_law"/);
assert.match(cockpitSource, /id="volume-emitter-source-depth"[^>]+data-volume-settings-param="volume_emitter_source_depth"/);
assert.match(cockpitSource, /id="volume-fixed-source-dephase"[^>]+data-volume-settings-param="volume_fixed_source_dephase"/);
assert.match(cockpitSource, /emitterSourceLaw: document\.getElementById\('volume-emitter-source-law'\)\.value/);
assert.match(cockpitSource, /emitterSourceDepth: parseFloat\(document\.getElementById\('volume-emitter-source-depth'\)\.value\)/);
assert.match(cockpitSource, /fixedSourceDephase: document\.getElementById\('volume-fixed-source-dephase'\)\.checked/);

const lawControl = settingsSchema.controls.find(({ key }) => key === 'volume-emitter-source-law');
assert.deepEqual(lawControl, {
  key: 'volume-emitter-source-law',
  param: 'volume_emitter_source_law',
  tagName: 'SELECT',
  type: 'select-one',
  additiveDefault: 'legacy-volume',
});
const depthControl = settingsSchema.controls.find(({ key }) => key === 'volume-emitter-source-depth');
assert.deepEqual(depthControl, {
  key: 'volume-emitter-source-depth',
  param: 'volume_emitter_source_depth',
  tagName: 'INPUT',
  type: 'range',
  additiveDefault: 0.04,
});
const dephaseControl = settingsSchema.controls.find(({ key }) => key === 'volume-fixed-source-dephase');
assert.deepEqual(dephaseControl, {
  key: 'volume-fixed-source-dephase',
  param: 'volume_fixed_source_dephase',
  tagName: 'INPUT',
  type: 'checkbox',
  additiveDefault: true,
});
assert.equal(settingsSchema.controlCount, settingsSchema.controls.length);

console.log('volume shallow emitter flux contracts passed');
