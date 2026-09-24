import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as color from '../volume-core.js';

assert.equal(typeof color.blackbodyXYZ, 'function', 'Boundary Fire exposes the Planck/CIE reference');
// CIE standard illuminant A chromaticity (2856 K Planckian source).
const xyz = color.blackbodyXYZ(2856);
const sum = xyz.reduce((a, b) => a + b, 0);
assert.ok(Math.abs(xyz[0] / sum - 0.44757) < 0.0002);
assert.ok(Math.abs(xyz[1] / sum - 0.40745) < 0.0002);
assert.throws(() => color.blackbodyXYZ(0), /temperature/);
assert.throws(() => color.blackbodyXYZ(NaN), /temperature/);
for (const t of [800, 1200, 1800, 2400, 4000, 6000]) {
  const rgb = color.thermalLinearRGB(t);
  assert.ok(rgb.every(Number.isFinite));
  assert.ok(Math.abs(color.linearLuminance(rgb) - 1) < 1e-6);
}
for (let t = 805; t < 6000; t += 10) {
  const exact = color.thermalLinearRGB(t);
  const lut = color.sampleThermalLUT(t);
  assert.ok(Math.max(...exact.map((v, i) => Math.abs(v - lut[i]))) < 0.0002, `LUT error at ${t}`);
}
assert.deepEqual(color.displayPhysicalRGB([0, 0, 0], 0, 0.6), [0, 0, 0]);
for (const input of [[1, 0.2, 0.01], [0.1, 0.4, 2], [20, 3, 0.01], [-0.01, 0.2, 1]]) {
  let previous = -1;
  for (let ev = -8; ev <= 8; ev++) {
    const output = color.displayPhysicalRGB(input, ev, 0.6);
    assert.ok(output.every(v => Number.isFinite(v) && v >= -1e-6 && v <= 1.000001));
    const luma = color.linearLuminance(output.map(color.srgbToLinear));
    assert.ok(luma >= previous - 1e-6, 'exposure increases displayed luminance');
    previous = luma;
  }
}
const input = [0.1, 0.02, 0.005];
const decoded = color.displayPhysicalRGB(input, 0, 0.6).map(color.srgbToLinear);
input.forEach((v, i) => assert.ok(Math.abs(v - decoded[i]) < 1e-7, 'sub-knee in-gamut radiance is unchanged'));
console.log('physical color reference, LUT accuracy, and display contracts passed');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
for (const key of ['mode', 'temperature', 'spread', 'thermal', 'clean', 'exposure', 'knee']) {
  const descriptor = schema.controls.find(c => c.key === `volume-physical-${key}`);
  assert.ok(descriptor, `saved color control ${key}`);
  assert.notEqual(descriptor.additiveDefault, undefined, 'old basins have explicit compatibility defaults');
}
