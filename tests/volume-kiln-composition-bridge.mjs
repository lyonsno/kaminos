import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const expression = source.match(/const volumeBridgeActive = (.*);/)?.[1];
assert.ok(expression, 'actual animation loop exposes its bridge decision');
const evaluate = new Function('liquidFireCompositionActive', 'fireLightFieldRouteActive',
  'isAuthoredKilnCollisionRoute', 'volumeBridge', `return (${expression});`);

for (const [liquid, light, kiln, expected] of [
  [false, false, true, false],
  [true, false, false, false],
  [false, true, false, false],
  [false, false, false, true],
]) {
  let uploads = 0;
  const active = evaluate(liquid, light, () => kiln, {update() { uploads++; return true; }});
  assert.equal(active, expected, `bridge activation: liquid=${liquid} light=${light} kiln=${kiln}`);
  assert.equal(uploads, Number(expected), 'native composition must not upload its canvas into its own scene');
}
assert.equal(evaluate(false, false, () => false, null), false);
console.log('volume kiln composition bridge: PASS');
