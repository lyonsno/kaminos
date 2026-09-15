import assert from 'node:assert/strict';
import { integrateEmission, thermalRadianceRGB, cameraWhiteBalance, displayEmissiveRGB, EMISSIVE_TRANSPORT_WGSL } from '../volume-emissive-transport.mjs';
import { linearLuminance } from '../volume-physical-color.mjs';

// Transport, not a verdict on whether the flame looks right.
assert.deepEqual(integrateEmission([2, 1, 0.5], 0, 0.25), { radiance: [0.5, 0.25, 0.125], transmittance: 1 });
for (const sigma of [1e-10, 0.1, 4, 80]) {
  const whole = integrateEmission([2, 1, 0.5], sigma, 1);
  const half = integrateEmission([2, 1, 0.5], sigma, 0.5);
  whole.radiance.forEach((v, i) => assert.ok(Math.abs(v - half.radiance[i] * (1 + half.transmittance)) < 1e-12));
  assert.ok(Math.abs(whole.transmittance - half.transmittance ** 2) < 1e-12);
}
assert.ok(Math.abs(linearLuminance(thermalRadianceRGB(1900)) - 1) < 1e-6);
assert.ok(linearLuminance(thermalRadianceRGB(2400)) > 10);
assert.ok(linearLuminance(thermalRadianceRGB(800)) < 1e-7);
const matrix = cameraWhiteBalance(4000);
// Material regression only: a heat/front carrier without transported soot
// must not manufacture incandescent particles. This is not image acceptance.
const hotSootExpression = EMISSIVE_TRANSPORT_WGSL.match(/let hotSoot = ([^;]+);/)[1]
  .replaceAll('u.physical_fire.w', 'thermalStrength');
const hotSootAt = new Function('coverage', 'sootYield', 'thermalStrength', 'smokeAmount', 'max', `return ${hotSootExpression}`);
assert.equal(hotSootAt(1, 1, 1, 0, Math.max), 0, 'no transported soot means no hot-soot extinction/emission');
assert.equal(hotSootAt(0, 1, 1, 1, Math.max), 0);
assert.equal(hotSootAt(1, 0, 1, 1, Math.max), 0);
assert.equal(hotSootAt(1, 1, 0, 1, Math.max), 0);
const energyExpression = EMISSIVE_TRANSPORT_WGSL.match(/let energy = ([^;]+);/)[1];
const energyAt = new Function('m', 'f', 'd', `return ${energyExpression}`);
assert.equal(energyAt({y:0}, {x:1,y:1,z:1}, {z:1}), 0, 'decorative flame/ember/lick carriers are not transported heat');
assert.ok(energyAt({y:1}, {x:0,y:0,z:0}, {z:0}) > 0);
// Production-linked shader contract, not just the CPU reference: channel-wise
// shoulder and selection must remain on the actual camera path. Existing native
// captures establish compilation/output; this narrow guard protects the formula.
const camera = EMISSIVE_TRANSPORT_WGSL.split('fn emissiveCamera(')[1].split('const LIGHT_GRID')[0];
assert.ok(camera.includes('let shoulder = vec3<f32>(1.0)-d*d/max(exposed+vec3<f32>(1.0-2.0*knee),vec3<f32>(d));'));
assert.ok(camera.includes('let linear = select(exposed, shoulder, exposed > vec3<f32>(knee));'));
assert.ok(camera.includes('linear*12.92,linear <= vec3<f32>(0.0031308)'));
assert.doesNotMatch(camera, /physicalDisplay\(|neutral|mappedPeak/);
assert.equal(displayEmissiveRGB([20,.5,.02])[2],displayEmissiveRGB([2,.5,.02])[2]);
assert.deepEqual(displayEmissiveRGB([0,0,0]),[0,0,0]);
for (const x of [.1,.6,1,10]) {
  const neutral = displayEmissiveRGB([x,x,x]);
  assert.equal(neutral[0],neutral[1]); assert.equal(neutral[1],neutral[2]);
  assert.ok(neutral[0] >= 0 && neutral[0] <= 1);
}
const white = thermalRadianceRGB(4000);
const balanced = matrix.map(row => row.reduce((sum, v, i) => sum + v * white[i], 0));
assert.ok(Math.max(...balanced) / Math.min(...balanced) < 1.001);
console.log('emissive coefficient integration, fixed-reference power, and camera white balance pass');
