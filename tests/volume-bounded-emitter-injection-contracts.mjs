import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as volumeCore from '../volume-core.js';
import { compileVolumeEmitterFamily } from '../volume-emitter-basis.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const mainShader = core.slice(
  core.indexOf('const WGSL ='),
  core.indexOf('const BROWSER_RESIDUAL_WGSL'),
);
const injectionShader = core.match(
  /const ANALYTIC_EMITTER_INJECTION_WGSL = \/\* wgsl \*\/[\s\S]*?\n`;/,
)?.[0] || '';

assert.equal(
  typeof volumeCore.analyticEmitterInjectionDispatch,
  'function',
  'volume core exports the deterministic fixed-emitter support dispatch contract',
);

const ring = compileVolumeEmitterFamily({
  family: 'ring',
  origin: [0, -0.76, 0],
  direction: [0, 1, 0],
  supportAxis: [1, 0, 0],
  radius: 0.024,
  ringRadius: 0.12,
  strength: 1.2,
  velocitySpeed: 0.22,
  frameId: 'bounded-ring-contract',
}).descriptor;

const ringDispatch = volumeCore.analyticEmitterInjectionDispatch(ring, 96);
assert.equal(ringDispatch.active, true);
assert.equal(ringDispatch.family, 'ring');
assert.deepEqual(ringDispatch.workgroupSize, [4, 4, 4]);
assert.ok(ringDispatch.cellCount > 0, 'Ring support dispatch visits its conservative local support');
assert.ok(
  ringDispatch.cellCount < (96 ** 3) / 100,
  `Ring support remains local instead of degenerating to the full grid: ${ringDispatch.cellCount}`,
);
assert.deepEqual(
  ringDispatch.workgroups,
  ringDispatch.cellExtent.map(cells => Math.ceil(cells / 4)),
  'dispatch geometry derives only from the clipped support extent',
);

const wick = compileVolumeEmitterFamily({
  family: 'wick',
  origin: [0, -0.76, 0],
  direction: [0, 1, 0],
  supportAxis: [1, 0, 0],
  radius: 0.016,
  length: 0.128,
  strength: 1,
  velocitySpeed: 0.2,
  frameId: 'bounded-wick-contract',
}).descriptor;
const wickDispatch = volumeCore.analyticEmitterInjectionDispatch(wick, 96);
assert.ok(wickDispatch.cellCount > 0);
assert.ok(wickDispatch.cellCount < ringDispatch.cellCount, 'narrow Wick dispatch is smaller than Ring support');

assert.deepEqual(
  volumeCore.analyticEmitterInjectionDispatch(null, 96),
  {
    active: false,
    family: 'cluster',
    grid: 96,
    workgroupSize: [4, 4, 4],
    cellMin: [0, 0, 0],
    cellExtent: [0, 0, 0],
    workgroups: [0, 0, 0],
    cellCount: 0,
  },
  'Cluster dispatches no fixed-emitter work',
);

assert.doesNotMatch(
  mainShader,
  /analyticEmitter|analyticCapsuleSignedDistance|analyticCylinderSignedDistance|analyticRibbonSignedDistance|analyticTorusSignedDistance/,
  'the ordinary full-grid fluid shader contains no fixed-emitter descriptor or SDF code',
);
assert.match(core, /const ANALYTIC_EMITTER_INJECTION_WGSL = \/\* wgsl \*\//, 'fixed morphology owns a separate shader');
assert.doesNotMatch(
  injectionShader,
  /\b(?:sin|cos)\s*\(/,
  'analytic emitter injection must not silently distort authored strength with a periodic scalar',
);
assert.match(
  injectionShader,
  /let weight = support \* max\(0\.0, emitter\.axis_strength\.w\);/,
  'bounded injection strength is the authored strength over geometric support',
);
assert.doesNotMatch(
  injectionShader,
  /velocityDensity\.xyz\s*=/,
  'bounded emitter WGSL does not assign through a non-assignable vector swizzle',
);
assert.match(
  injectionShader,
  /let legacyInjectedDensity = clamp\(max\([\s\S]*?material\.x \* 1\.08 \+ microLayer\.x \* 0\.08[\s\S]*?material\.y \* 0\.42[\s\S]*?material\.w \* 0\.18[\s\S]*?microLayer\.y \* 0\.20[\s\S]*?microLayer\.z \* 0\.05[\s\S]*?material\.z \* 0\.10[\s\S]*?0\.0, 2\.2\);/,
  'the legacy filled-volume source retains its density reconstruction law',
);
assert.match(
  injectionShader,
  /let injectedDensity = select\(velocityDensity\.w, legacyInjectedDensity, sourceLaw < 0\.5\);/,
  'density reconstruction is effective only for the legacy law while shallow-primary preserves transported density',
);
assert.match(
  injectionShader,
  /let injectedVelocity = clamp\([\s\S]*?fluid\[base\] = vec4<f32>\(injectedVelocity, injectedDensity\);/,
  'the bounded source write consumes the law-selected density contract',
);
assert.match(core, /function encodeAnalyticEmitterInjection\(encoder\)/, 'fixed morphology owns a separate encoder boundary');
assert.match(
  core,
  /currentFluid = 1 - currentFluid;[\s\S]*?encodeAnalyticEmitterInjection\(encoder\);[\s\S]*?encodePressureProjection\(encoder/,
  'bounded source injection runs after fluid transport and before pressure projection',
);
assert.match(
  core,
  /pass\.dispatchWorkgroups\(\.\.\.dispatch\.workgroups\)/,
  'the emitter pass dispatches its support-local workgroups rather than the full grid',
);
assert.match(core, /analyticEmitterCellVisitsThisFrame/, 'the cost ledger exposes fixed-emitter cell work separately');
assert.match(core, /analyticEmitterFullGridEquivalentPasses/, 'the cost ledger reports the local pass as a fractional full-grid equivalent');

console.log('volume bounded emitter injection contracts passed');
