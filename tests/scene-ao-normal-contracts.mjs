import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual pre-pass expression. Native kiln evidence separately
// exercises Three's shader build, raster winding and GTAO integration.
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = source.indexOf('  const prePass = pass(scene, camera);');
const end = source.indexOf('  const prePassNormal =', start);
assert.ok(start >= 0 && end > start);
class Vector {
  constructor(value) { this.value = value; }
  negate() { return new Vector(this.value.map(v => -v)); }
  dot(other) {
    const value = this.value.reduce((sum, v, i) => sum + v * other.value[i], 0);
    return { lessThan: bound => ({ select: (yes, no) => value < bound ? yes : no }) };
  }
}
function normalOutput(normal, view) {
  let output;
  const prePass = { setMRT(value) { output = value.output; } };
  vm.runInNewContext(source.slice(start, end), {
    scene: {}, camera: {}, pass: () => prePass, mrt: value => value,
    packNormalToRGB: value => value,
    normalView: new Vector(normal), positionViewDirection: new Vector(view),
  });
  return output.value;
}
for (const [normal, view] of [
  [[0, 0, 1], [0, 0, 1]],
  [[0.6, 0, 0.8], [0, 0, 1]],
  [[0.6, 0, 0.8], [0.8, 0, 0.6]],
  [[0.99995, 0, 0.01], [0, 0, 1]],
]) {
  const opposite = normal.map(v => -v);
  assert.deepEqual(normalOutput(normal, view), normal, 'valid camera-facing normals remain unchanged');
  assert.deepEqual(normalOutput(opposite, view), normal,
    'AO must use the visible hemisphere even when winding makes the material normal point away');
}
assert.deepEqual(normalOutput([1, 0, 0], [0, 0, 1]), [1, 0, 0], 'exact tangent is finite and unchanged');
console.log('scene AO visible-normal contracts passed');
