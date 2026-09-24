import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const body = core.match(/fn vorticityConfinement\([^]*?\{([^]*?)\n\}/)?.[1];
assert.ok(body, 'the production confinement function must exist');
// Execute the arithmetic tail of the actual production helper, with its sampled
// gradient and vorticity supplied as inputs. This is a small CPU arithmetic
// adapter, not WGSL compilation or evidence about a rendered flame.
const tail = body.slice(body.indexOf(';', body.indexOf('let magZ')) + 1);
assert.match(tail, /return cross\(/, 'evaluate the production force return');
const js = tail
  .replaceAll('vec3<f32>', 'vec3')
  .replace(/vec3\(([^()]*)\)\s*\+\s*vec3\(([^()]*)\)/g, 'add(vec3($1), vec3($2))')
  .replace(/\bgradient\s*\/\s*(magnitude|gradientScale)\b/g, 'divide(gradient, $1)')
  .replaceAll('curlAtCell(c)', 'omega')
  .replace(/return cross\(([^;]*)\)\s*\*\s*amount\s*;/g, 'return scale(cross($1), amount);');
const f = Math.fround;
const vec3 = (...v) => (v.length === 1 ? [v[0], v[0], v[0]] : v).map(f);
const add = (a, b) => a.map((v, i) => f(v + b[i]));
const divide = (a, s) => a.map(v => f(v / s));
const scale = (a, s) => a.map(v => f(v * s));
const length = a => f(Math.sqrt(f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]))));
const normalize = a => divide(a, length(a));
const cross = (a, b) => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
];
const evaluate = new Function(
  'magX', 'magY', 'magZ', 'omega', 'amount',
  'vec3', 'add', 'divide', 'scale', 'length', 'normalize', 'cross', 'max', 'abs', js,
);
const force = (gradient, omega, amount = 1) => evaluate(
  ...gradient.map(f), omega.map(f), f(amount),
  vec3, add, divide, scale, length, normalize, cross, Math.max, Math.abs,
);
const near = (actual, expected, tolerance = 3e-7) => actual.forEach((v, i) => {
  assert.ok(Number.isFinite(v), `component ${i} must remain finite: ${actual}`);
  assert.ok(Math.abs(v - expected[i]) <= tolerance, `${actual} differs from ${expected}`);
});
const rotateY = ([x, y, z]) => [z, y, -x];

test('uniform vorticity magnitude has zero confinement, not a fixed diagonal', () => {
  assert.deepEqual(force([0, 0, 0], [0, 0.04, 0]), [0, 0, 0]);
});

test('zero vorticity and parallel gradient/vorticity have zero force', () => {
  near(force([1, 2, 3], [0, 0, 0]), [0, 0, 0], 0);
  near(force([1, 0, 0], [2, 0, 0]), [0, 0, 0], 0);
});

test('nonzero gradients retain the existing cross-product direction and gain', () => {
  near(force([1, 0, 0], [0, 0, 2], 0.5), [0, -1, 0]);
  near(force([-1, 0, 0], [0, 0, 2], 0.5), [0, 1, 0]);
  near(force([0, 3, 4], [2, 0, 0], 0.25), [0, 0.4, -0.3]);
});

test('zero-safe normalization adds no weak-gradient amplitude mask', () => {
  for (const magnitude of [1e-30, 1e-23, 1e-10, 1e-7, 1e-4, 1, 10]) {
    near(force([magnitude, 0, 0], [0, 0, 2], 0.5), [0, -1, 0]);
  }
});

test('rotating the sampled fields around gravity rotates the force with them', () => {
  for (const gradient of [[0.003, -0.006, 0.001], [1e-7, 0, 0], [1e-23, 2e-23, -3e-23], [0, 0, 0]]) {
    const omega = [0.04, -0.03, 0.02];
    near(force(rotateY(gradient), rotateY(omega), 0.21), rotateY(force(gradient, omega, 0.21)));
  }
});

test('normalization retains direction below the float32 square-underflow boundary', () => {
  near(force([1e-23, 0, 0], [0, 0, 2], 0.5), [0, -1, 0]);
  near(force([0, 3e-30, 4e-30], [2, 0, 0], 0.25), [0, 0.4, -0.3]);
  const tinyGradient = [1e-23, 2e-23, -3e-23];
  const reference = force([1, 2, -3], [0.04, -0.03, 0.02]);
  near(force(tinyGradient, [0.04, -0.03, 0.02]), reference);
  near(force(rotateY(tinyGradient), rotateY([0.04, -0.03, 0.02])), rotateY(reference));
});
