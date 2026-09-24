import assert from 'node:assert/strict';
import { integrateCoupledOpticalRay } from '../volume-coupled-optical-transfer.mjs';

const zeroSource = [0, 0, 0];
const segment = (overrides = {}) => ({
  stepLength: 1,
  smokeExtinction: 0,
  flameExtinction: 0,
  smokeSource: zeroSource,
  flameEmission: zeroSource,
  ...overrides,
});

const unattenuated = integrateCoupledOpticalRay([
  segment({ stepLength: 0.5, flameEmission: [1, 2, 3] }),
]);
for (const [lane, expected] of [0.5, 1, 1.5].entries()) {
  assert.ok(Math.abs(unattenuated.radiance[lane] - expected) < 1e-12);
}
assert.equal(unattenuated.transmittance, 1);

const homogeneous = integrateCoupledOpticalRay([
  segment({
    stepLength: 0.5,
    smokeExtinction: 1.25,
    flameExtinction: 0.75,
    flameEmission: [0, 0, 4],
  }),
]);
const expectedHomogeneousRadiance = 4 * (1 - Math.exp(-1)) / 2;
assert.ok(Math.abs(homogeneous.radiance[2] - expectedHomogeneousRadiance) < 1e-12);
assert.equal(homogeneous.opticalDepth, 1);
assert.equal(homogeneous.transmittance, Math.exp(-1));

const underflowedOpticalDepth = integrateCoupledOpticalRay([
  segment({
    stepLength: 1e-200,
    smokeExtinction: 1e-200,
    flameEmission: [1e200, 0, 0],
  }),
]);
assert.ok(Math.abs(underflowedOpticalDepth.radiance[0] - 1) < 1e-12,
  'a positive extinction with underflowed optical depth must approach the zero-extinction source integral');

const recoveredAfterAttenuationUnderflow = integrateCoupledOpticalRay([
  segment({ smokeExtinction: 740 }),
  segment({ stepLength: 1e308, flameEmission: [1e-10, 0, 0] }),
]);
const expectedRecoveredRadiance = Math.exp(Math.log(1e-10) + Math.log(1e308) - 740);
assert.ok(Math.abs(recoveredAfterAttenuationUnderflow.radiance[0] - expectedRecoveredRadiance)
  <= expectedRecoveredRadiance * 1e-12,
'attenuation that underflows alone must not erase a representable later source contribution');

const finiteAfterSourceCombination = integrateCoupledOpticalRay([
  segment({
    stepLength: 0.1,
    smokeSource: [1e308, 0, 0],
    flameEmission: [1e308, 0, 0],
  }),
]);
const expectedCombinedRadiance = 2 * (1e308 * 0.1);
assert.ok(Math.abs(finiteAfterSourceCombination.radiance[0] - expectedCombinedRadiance)
  <= expectedCombinedRadiance * 1e-12,
  'separately finite smoke and flame sources must not overflow before their finite integrated contributions are added');

const smokeInFront = integrateCoupledOpticalRay([
  segment({ smokeExtinction: 2, smokeSource: [0, 0, 0.4] }),
  segment({ flameEmission: [3, 0, 0] }),
]);
assert.ok(Math.abs(smokeInFront.radiance[0] - 3 * Math.exp(-2)) < 1e-12,
  'foreground soot extinction must attenuate flame radiance from the same ray');
assert.ok(Math.abs(smokeInFront.radiance[2] - 0.4 * (1 - Math.exp(-2)) / 2) < 1e-12,
  'smoke source must contribute through its own extinction');
assert.equal(smokeInFront.transmittance, Math.exp(-2));

const smokeBehind = integrateCoupledOpticalRay([
  segment({ flameEmission: [3, 0, 0] }),
  segment({ smokeExtinction: 2, smokeSource: [0, 0, 0.4] }),
]);
assert.ok(Math.abs(smokeBehind.radiance[0] - 3) < 1e-12,
  'smoke behind the flame must not attenuate the foreground flame');
assert.notDeepEqual(smokeBehind.radiance, smokeInFront.radiance,
  'depth order must affect the coupled field result');

const background = integrateCoupledOpticalRay([
  segment({ smokeExtinction: 0.5 }),
], { backgroundRadiance: [2, 4, 6] });
const expectedBackground = [2, 4, 6].map(channel => channel * Math.exp(-0.5));
for (let lane = 0; lane < 3; lane += 1) {
  assert.ok(Math.abs(background.radiance[lane] - expectedBackground[lane]) < 1e-12);
}

assert.throws(
  () => integrateCoupledOpticalRay([segment({ smokeExtinction: -1 })]),
  /smokeExtinction must be finite and non-negative/,
);
assert.throws(
  () => integrateCoupledOpticalRay([segment({ stepLength: 0 })]),
  /stepLength must be finite and positive/,
);
assert.throws(
  () => integrateCoupledOpticalRay([segment({ flameEmission: [1, Number.NaN, 0] })]),
  /flameEmission channel must be finite and non-negative/,
);
assert.throws(
  () => integrateCoupledOpticalRay([segment({
    smokeExtinction: Number.MAX_VALUE,
    flameExtinction: Number.MAX_VALUE,
  })]),
  /total extinction must be finite/,
);
assert.throws(
  () => integrateCoupledOpticalRay([segment({
    smokeSource: [Number.MAX_VALUE, 0, 0],
    flameEmission: [Number.MAX_VALUE, 0, 0],
  })]),
  /radiance contribution must be finite/,
);

console.log('volume coupled optical transfer contracts passed');
