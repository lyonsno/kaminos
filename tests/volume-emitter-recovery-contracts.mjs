import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { compileVolumeEmitterFamily } from '../volume-emitter-basis.mjs';
import { applyVolumeEmitterFamilyRuntime } from '../volume-emitter-runtime.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const cockpit = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const heldControls = Object.freeze({
  inputRadius: 0.12,
  flowRate: 1.2,
  fire: 1.4,
  smoke: 2.8,
});

const ring = compileVolumeEmitterFamily({
  family: 'ring',
  origin: [0, -0.76, 0],
  direction: [0, 1, 0],
  supportAxis: [1, 0, 0],
  radius: 0.024,
  ringRadius: 0.12,
  strength: 1.2,
  velocitySpeed: 0.22,
  frameId: 'analytic-ring-contract',
});

assert.equal(ring.effective.support.primitive, 'analytic-annulus', 'Ring is one analytic annulus, not a segmented line approximation');
assert.equal(ring.effective.sourceCount, 1, 'Ring has one coherent source modulation field');
assert.equal(ring.descriptor.family, 'ring', 'the compiler returns a compact analytic descriptor');
assert.equal(ring.descriptor.coordinateSpace, 'volume-local');
assert.equal(ring.carrier, undefined, 'fixed morphology does not enter the arbitrary external-segment carrier');
assert.equal(Object.hasOwn(ring.requested, 'ringSegments'), false, 'analytic Ring has no tessellation control or segment-count cost axis');

const calls = { controls: [], coreSource: [], analytic: [], external: [] };
const prototype = {
  setControls(controls) {
    calls.controls.push(structuredClone(controls));
  },
  setCoreEmitterSourceMode(mode) {
    calls.coreSource.push(mode);
    return {
      requestedMode: mode,
      effectiveMode: mode,
      effectiveFlowRate: mode === 'analytic-only' ? 0 : heldControls.flowRate,
    };
  },
  setAnalyticEmitterDescriptor(descriptor) {
    calls.analytic.push(structuredClone(descriptor));
    return {
      mode: descriptor ? 'analytic-fixed' : 'off',
      family: descriptor?.family ?? 'cluster',
      sourceLaw: descriptor?.sourceLaw ?? 'legacy-volume',
      sourceDepth: descriptor?.sourceDepth ?? 0.04,
      coordinateSpace: descriptor ? 'volume-local' : 'none',
      count: descriptor ? 1 : 0,
    };
  },
  setExternalEmitters(payload) {
    calls.external.push(structuredClone(payload));
    return {
      mode: payload.mode,
      coordinateSpace: payload.emitters.length ? 'volume-local' : 'none',
      count: payload.emitters.length,
      frameId: payload.frameId,
    };
  },
};

const ringRuntime = applyVolumeEmitterFamilyRuntime({
  prototype,
  family: 'ring',
  controls: heldControls,
  timestampMs: 1_000,
  frameId: 'analytic-ring-runtime',
});
assert.deepEqual(calls.coreSource, ['analytic-only'], 'fixed morphology selects the analytic source authority');
assert.equal(calls.analytic.length, 1, 'fixed morphology writes one compact descriptor');
assert.equal(calls.external.length, 0, 'fixed morphology performs no external carrier buffer write');
assert.equal(ringRuntime.effective.sourceMode, 'analytic-fixed');
assert.equal(ringRuntime.effective.sourceCount, 1);

const analyticInjectionShader = core.match(/const ANALYTIC_EMITTER_INJECTION_WGSL = \/\* wgsl \*\/[\s\S]*?\n`;/)?.[0] || '';
assert.match(analyticInjectionShader, /torusSignedDistance/, 'bounded injection pass evaluates Ring from an analytic torus distance');
assert.match(analyticInjectionShader, /smoothstep\([^\n]+cellWidth/, 'analytic support uses a grid-aware compact antialias transition');
assert.match(analyticInjectionShader, /support <= 0\.0/, 'analytic support exits exactly outside the compact boundary');
assert.doesNotMatch(analyticInjectionShader, /\bfor\s*\(/, 'fixed analytic morphology remains O(1) per dispatched support cell');
assert.doesNotMatch(
  analyticInjectionShader,
  /normalize\s*\(/,
  'the analytic basis is normalized once at descriptor admission, not once per dispatched support cell',
);
assert.doesNotMatch(
  core.slice(core.indexOf('const WGSL ='), core.indexOf('const ANALYTIC_EMITTER_INJECTION_WGSL')),
  /analyticEmitter|analyticCapsuleSignedDistance|analyticCylinderSignedDistance|analyticRibbonSignedDistance|analyticTorusSignedDistance/,
  'fixed morphology is absent from the ordinary full-grid fluid shader',
);
assert.match(core, /fn externalEmitterInfluence\([\s\S]*?for \(var i:/, 'the generic segment carrier remains available for real arbitrary trails');

const syncControls = cockpit.match(/const syncControls = event => \{[\s\S]*?\n  };/)?.[0] || '';
assert.match(cockpit, /const emitterMorphologyControls = new Set\(\['emitter-assay-family', 'volume-emitter-source-law', 'volume-emitter-source-depth', 'volume-input-radius', 'volume-flow-rate'\]\)/, 'only source-law and morphology-bearing controls update the compact descriptor');
assert.match(cockpit, /if \(emitterMorphologyControls\.has\(event\?\.target\?\.id\)\) \{\s*applyVolumeEmitterFamilyRuntimeToCockpit\(controlsSnapshot\);/, 'every morphology edit republishes the requested/effective source receipt, including inactive Cluster mode');
assert.match(
  syncControls,
  /if \(emitterMorphologyControls\.has\(event\?\.target\?\.id\)\) \{\s*applyVolumeEmitterFamilyRuntimeToCockpit\(controlsSnapshot\);[\s\S]*?} else if \(event\?\.target\?\.id === 'volume-scene' && selectedEmitterFamily !== 'cluster'\)[\s\S]*?applyVolumeEmitterFamilyRuntimeToCockpit\(controlsSnapshot\)[\s\S]*?} else \{\s*volumePrototype\.setControls\(controlsSnapshot\)/,
  'morphology edits traverse the receipt-owning runtime boundary while unrelated controls retain the direct control path',
);

console.log('volume analytic emitter recovery contracts passed');
