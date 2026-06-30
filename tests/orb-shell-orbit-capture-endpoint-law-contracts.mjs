import assert from 'node:assert/strict';
import { createTargetOrbShellCompositionFixture } from '../orb-shell-composition-core.js';

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.macroFamilySubstripPlan;
const witness = plan?.apertureTangencyWitnessPlan;

assert.equal(witness?.schema, 'ApertureTangencyWitnessPlan', 'aperture tangency witness plan missing');
assert.equal(witness.measuredApertureSourceId, 'primary-front-teardrop-void', 'endpoint law must measure visible aperture orbit');

const orbitSamples = witness.samples.filter(sample => sample.requestedTerminationClass === 'orbit-capture');
const counterSamples = witness.samples.filter(sample => sample.requestedTerminationClass === 'counter-curve-blade');

assert.equal(orbitSamples.length, 3, 'wide-cup endpoint-law slice should still expose three orbit-capture sibling samples');
assert.ok(
  orbitSamples.every(sample => sample.classVerdict === 'measured-orbit-capture-coupling'),
  `orbit-capture siblings must be measured as captured, got ${orbitSamples.map(sample => `${sample.siblingRole}:${sample.classVerdict}`).join(', ')}`,
);
assert.ok(
  orbitSamples.every(sample => sample.captureRadiusError <= 0.28),
  `orbit-capture siblings must terminate within the visible aperture capture radius, got ${orbitSamples.map(sample => `${sample.siblingRole}:${sample.captureRadiusError.toFixed(3)}`).join(', ')}`,
);
assert.ok(
  orbitSamples.every(sample => sample.tangentOrbitAlignment >= 0.72),
  `orbit-capture siblings must remain tangent to the visible aperture orbit, got ${orbitSamples.map(sample => `${sample.siblingRole}:${sample.tangentOrbitAlignment.toFixed(3)}`).join(', ')}`,
);

const terminalPoints = orbitSamples.map(sample => sample.terminalPoint);
const terminalDistances = [];
for (let i = 0; i < terminalPoints.length; i++) {
  for (let j = i + 1; j < terminalPoints.length; j++) {
    terminalDistances.push(Math.hypot(
      terminalPoints[i][0] - terminalPoints[j][0],
      terminalPoints[i][1] - terminalPoints[j][1],
      terminalPoints[i][2] - terminalPoints[j][2],
    ));
  }
}
assert.ok(
  Math.max(...terminalDistances) >= 0.08,
  'orbit-capture siblings must not collapse into one identical aperture endpoint',
);

const tuckedCounter = counterSamples.find(sample => sample.siblingRole === 'tucked');
assert.ok(tuckedCounter, 'counter-curve tucked secondary sample missing');
assert.equal(
  tuckedCounter.classVerdict,
  'measured-counter-curve-refusal',
  'tucked counter-curve secondary should stop reading as accidental orbit capture',
);
