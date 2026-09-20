import assert from 'node:assert/strict';
import * as transport from '../volume-emissive-transport.mjs';

const directions = transport.EMISSIVE_LIGHT_DIRECTIONS;
assert.ok(Array.isArray(directions), 'production exports the oblique transport direction basis');
assert.equal(directions.length, 12, 'incident transport uses the twelve icosahedral vertices');

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const magnitude = vector => Math.sqrt(dot(vector, vector));
for (const direction of directions) {
  assert.equal(direction.length, 3);
  assert.ok(Math.abs(magnitude(direction) - 1) < 1e-12, 'transport directions are unit length');
  assert.ok(Math.max(...direction.map(Math.abs)) < 0.95, 'no transport direction is a cardinal axis');
  assert.ok(directions.some(candidate => candidate.every((value, i) => Math.abs(value + direction[i]) < 1e-12)), 'every direction has an antipode');
}

for (let row = 0; row < 3; row++) {
  for (let column = 0; column < 3; column++) {
    const moment = directions.reduce((sum, direction) => sum + direction[row] * direction[column], 0) / directions.length;
    assert.ok(Math.abs(moment - (row === column ? 1 / 3 : 0)) < 1e-12, 'equal-weight direction moments are isotropic');
  }
}

// A homogeneous absorbing slab has an analytic directional response. This is
// a quadrature contract, not image acceptance or a full grid-solver proxy.
const slabResponse = (basis, normal, opticalDepth = 1) => basis.reduce((sum, direction) => {
  const cosine = Math.abs(dot(direction, normal));
  return sum + Math.exp(-opticalDepth / Math.max(cosine, 1e-9));
}, 0) / basis.length;
const normals = Array.from({ length: 1000 }, (_, i) => {
  const z = 1 - 2 * (i + 0.5) / 1000;
  const azimuth = i * 2.399963229728653;
  const radius = Math.sqrt(1 - z * z);
  return [radius * Math.cos(azimuth), radius * Math.sin(azimuth), z];
});
const responses = normals.map(normal => slabResponse(directions, normal));
const mean = responses.reduce((sum, value) => sum + value, 0) / responses.length;
const deviation = Math.sqrt(responses.reduce((sum, value) => sum + (value - mean) ** 2, 0) / responses.length);
assert.ok(deviation / mean < 0.015, 'equal-weight slab response has low orientation bias at unit optical depth');

const shader = transport.EMISSIVE_TRANSPORT_WGSL;
assert.match(shader, /const LIGHT_DIRECTIONS: u32 = 12u;/);
assert.match(shader, /fn lightDirection\(direction: u32\) -> vec3<f32>/);
assert.match(shader, /fn samplePreviousOutgoing\(/);
assert.match(shader, /@group\(3\) @binding\(4\) var<uniform> emissiveSweepStep:/);
assert.match(shader, /samplePreviousOutgoing\(direction/);
assert.match(shader, /let ds = \(2\.0\/f32\(LIGHT_GRID\)\)\/dominant;/);
assert.doesNotMatch(shader, /let direction = id\.x\/plane; let column = id\.x%plane;[\s\S]*for\(var step=0u;step<LIGHT_GRID;step\+\+\)/);

console.log('emissive oblique transport: direction quadrature and ordered short-characteristics contract pass');
