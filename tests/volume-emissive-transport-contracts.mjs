import assert from 'node:assert/strict';
import { integrateEmission, thermalRadianceRGB, cameraWhiteBalance } from '../volume-emissive-transport.mjs';
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
const white = thermalRadianceRGB(4000);
const balanced = matrix.map(row => row.reduce((sum, v, i) => sum + v * white[i], 0));
assert.ok(Math.max(...balanced) / Math.min(...balanced) < 1.001);
console.log('emissive coefficient integration, fixed-reference power, and camera white balance pass');
