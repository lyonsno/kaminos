import assert from 'node:assert/strict';
import { displayPhysicalRGB, thermalLinearRGB, srgbToLinear, linearLuminance } from '../volume-physical-color.mjs';

// Operator defect: mid-bright warm thermal radiance becomes broad salmon even
// with zero blue emission and zero smoke. These are display-policy bounds, not
// a claim that a blackbody spectrum alone dictates photographed fire appearance.
for (const temperature of [1400, 1900, 2400]) {
  const output = displayPhysicalRGB(thermalLinearRGB(temperature).map(v => v * 0.6)).map(srgbToLinear);
  assert.ok(output[2] / output[0] < 0.2, `${temperature} K at Y=.6 retains warm chroma instead of a pastel blue floor: ${output}`);
  assert.ok(output[0] > 0.8, 'warm body still reaches a bright red channel');
  assert.ok(output[1] > 0.1, 'warm body is not flattened into pure red');
}

// Exposure must remain useful past the old near-white Y=1 shoulder.
const warm = thermalLinearRGB(1900);
let previous = [0, 0, 0];
for (let ev = -8; ev <= 16; ev += 0.25) {
  const output = displayPhysicalRGB(warm, ev).map(srgbToLinear);
  output.forEach((v, i) => {
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1.000001);
    assert.ok(v >= previous[i] - 1e-6, 'no channel darkens along a fixed-chroma exposure sweep');
  });
  previous = output;
}
assert.ok(previous.every(v => v > 0.99), 'very strong highlights converge to white, not a saturated primary plateau');
const medium = displayPhysicalRGB(warm).map(srgbToLinear);
assert.ok(medium[2] / medium[0] < 0.3, 'Y=1 is still a warm highlight, not almost white');
assert.ok(linearLuminance(medium) > linearLuminance(displayPhysicalRGB(warm.map(v => v * 0.6)).map(srgbToLinear)));

// Smooth shoulder at every operator knee; below it, in-gamut RGB is untouched.
for (const knee of [0.1, 0.6, 0.95]) {
  const rgb = [knee, knee * 0.3, knee * 0.02];
  const at = displayPhysicalRGB(rgb, 0, knee).map(srgbToLinear);
  const below = displayPhysicalRGB(rgb.map(v => v * (1-1e-6)), 0, knee).map(srgbToLinear);
  const above = displayPhysicalRGB(rgb.map(v => v * (1+1e-6)), 0, knee).map(srgbToLinear);
  at.forEach((v, i) => {
    assert.ok(Math.abs(v-rgb[i]) < 1e-7, 'peak knee joins the linear region');
    assert.ok(Math.abs((above[i]-at[i])-(at[i]-below[i])) < 1e-9, 'continuous shoulder slope');
  });
}
assert.deepEqual(displayPhysicalRGB([0,0,0]), [0,0,0]);
assert.deepEqual(displayPhysicalRGB([-1,-1,-1]), [0,0,0]);
console.log('warm highlight retention, monotonic exposure, white convergence, and knee continuity passed');
