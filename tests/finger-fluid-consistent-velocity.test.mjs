import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Execute the production stage's two vector reads component-wise. This checks
// field semantics without substituting a second implementation of the reads;
// native GPU dispatch is a separate conformance witness.
const source = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
const body = source.split('fn compute_velocity_viscosity(')[1].split('@compute')[0];
const self = body.match(/var velocity = (.*);/)[1];
const neighbor = body.match(/neighborVelocity = neighborVelocity \+ (.*) \* weight;/)[1];
function read(expression, particles, index, neighborIndex, dt) {
  const scalar = expression.replaceAll('.xyz', '[axis]').replaceAll('max(', 'Math.max(');
  const evaluate = new Function('particles', 'particle', 'position', 'neighborIndex', 'params', 'axis', `return ${scalar};`);
  return [0, 1, 2].map(axis => evaluate(particles, particles[index], particles[index].predicted[axis], neighborIndex, {dt}, axis));
}
function particle(position, corrected, old, dt = .01) {
  return {position, predicted: position.map((x, a) => x + dt * corrected[a]), velocity: old};
}
function smooth(particles, index, weights, blend, dt = .01) {
  const local = read(self, particles, index, index, dt);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return local;
  return local.map((v, axis) => (1 - blend) * v + blend * weights.reduce((sum, weight, j) => sum + weight * read(neighbor, particles, index, j, dt)[axis], 0) / total);
}
function near(actual, expected) {
  actual.forEach((x, a) => assert.ok(Math.abs(x - expected[a]) < 1e-10, `${actual} != ${expected}`));
}
const uniform = [0, 1, 2].map(i => particle([i * .05, 1.5, .6], [2, -.4, .3], [.1, .2, -.1]));
for (const blend of [0, .07, .14, .24]) {
  for (let i = 0; i < 3; i++) near(smooth(uniform, i, [0, 1, 2].map(j => j === i ? 0 : 1), blend), [2, -.4, .3]);
}
const varied = [particle([0, 0, 0], [1, 2, 3], [9, 8, 7]), particle([.05, 0, 0], [3, 4, 5], [6, 5, 4]), particle([.1, 0, 0], [-1, 0, 1], [3, 2, 1])];
near(smooth(varied, 0, [0, 3, 1], .2), [1.2, 2.2, 3.2]);
near(smooth(varied, 0, [0, 0, 0], .24), [1, 2, 3]);
// Both reads use the same denominator even at the existing small-dt guard.
near(read(self, varied, 1, 1, 0), read(neighbor, varied, 0, 1, 0));
assert.doesNotMatch(body, /particles\[[^\]]+\]\.(?:position|predicted|velocity)\s*=/, 'smoothing must not mutate its input field');
assert.doesNotMatch(neighbor, /\.delta/, 'neighbors must not read concurrently written results');
console.log('Consistent PBF velocity: uniform correction, nonuniform smoothing, isolated particle and timestep guard pass');
