import assert from 'node:assert/strict';
import * as transport from '../volume-emissive-transport.mjs';

const directions = transport.EMISSIVE_LIGHT_DIRECTIONS;
const weights = transport.EMISSIVE_LIGHT_WEIGHTS;
assert.equal(directions.length, 14, 'incident transport uses six axes plus eight body diagonals');
assert.equal(weights.length, directions.length, 'every ordinate has an explicit quadrature weight');

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const magnitude = vector => Math.sqrt(dot(vector, vector));
const cardinalCount = directions.filter(direction => direction.filter(value => Math.abs(value) > 1e-12).length === 1).length;
const obliqueCount = directions.filter(direction => direction.every(value => Math.abs(value) > 0.5)).length;
assert.equal(cardinalCount, 6, 'all Cartesian axes remain represented');
assert.equal(obliqueCount, 8, 'all cube body diagonals represent oblique transport');
assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12, 'quadrature weights sum to one');

for (let i = 0; i < directions.length; i++) {
  const direction = directions[i];
  assert.ok(Math.abs(magnitude(direction) - 1) < 1e-12, 'transport directions are unit length');
  const antipode = directions.findIndex(candidate => candidate.every((value, axis) => Math.abs(value + direction[axis]) < 1e-12));
  assert.ok(antipode >= 0, 'every direction has an antipode');
  assert.ok(Math.abs(weights[antipode] - weights[i]) < 1e-12, 'antipodes have equal quadrature weight');
}

const weightedMoment = powers => directions.reduce((sum, direction, i) => (
  sum + weights[i] * direction.reduce((product, value, axis) => product * value ** powers[axis], 1)
), 0);
for (let axis = 0; axis < 3; axis++) {
  const second = [0, 0, 0]; second[axis] = 2;
  const fourth = [0, 0, 0]; fourth[axis] = 4;
  assert.ok(Math.abs(weightedMoment(second) - 1 / 3) < 1e-12, 'weighted second moment is isotropic');
  assert.ok(Math.abs(weightedMoment(fourth) - 1 / 5) < 1e-12, 'weighted fourth axial moment is isotropic');
}
assert.ok(Math.abs(weightedMoment([2, 2, 0]) - 1 / 15) < 1e-12, 'weighted mixed fourth moment is isotropic');

const slabResponse = normal => directions.reduce((sum, direction, i) => {
  const cosine = Math.abs(dot(direction, normal));
  return sum + weights[i] * Math.exp(-1 / Math.max(cosine, 1e-9));
}, 0);
const responses = Array.from({ length: 1000 }, (_, i) => {
  const z = 1 - 2 * (i + 0.5) / 1000;
  const azimuth = i * 2.399963229728653;
  const radius = Math.sqrt(1 - z * z);
  return slabResponse([radius * Math.cos(azimuth), radius * Math.sin(azimuth), z]);
});
const mean = responses.reduce((sum, value) => sum + value, 0) / responses.length;
const deviation = Math.sqrt(responses.reduce((sum, value) => sum + (value - mean) ** 2, 0) / responses.length);
assert.ok(deviation / mean < 0.015, 'weighted slab response has low orientation bias at unit optical depth');

const shader = transport.EMISSIVE_TRANSPORT_WGSL;
assert.match(shader, /const LIGHT_DIRECTIONS: u32 = 14u;/);
assert.match(shader, /const LIGHT_DIRECTION_WEIGHTS = array<f32,14>/);
assert.match(shader, /fn lightRayStart\(/);
assert.match(shader, /fn lightRayStep\(/);
assert.match(shader, /for\(var step=0u;step<LIGHT_GRID;step\+\+\)/);
assert.match(shader, /LIGHT_DIRECTION_WEIGHTS\[direction\]/);
assert.doesNotMatch(shader, /samplePreviousOutgoing/);
assert.doesNotMatch(shader, /emissiveSweepStep/);

console.log(`emissive lattice transport: 6 cardinal + 8 oblique ordinates; slab bias ${(deviation / mean).toFixed(5)}`);
