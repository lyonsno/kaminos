import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const expression = source.match(/const volumeBridgeActive = (.*);/)?.[1];
assert.ok(expression, 'actual animation loop exposes its bridge decision');
const evaluate = new Function('liquidFireCompositionActive', 'fireLightFieldRouteActive',
  'isAuthoredKilnCollisionRoute', 'volumeBridge', 'fireProxyEffective', `return (${expression});`);

for (const [liquid, light, kiln, proxy, expected] of [
  [false, false, true, false, false],
  [true, false, false, false, false],
  [false, true, false, false, false],
  [false, false, false, false, true],
  // Fire Proxy display draws splats instead; the full fire is not uploaded.
  [false, false, false, true, false],
]) {
  let uploads = 0;
  const active = evaluate(liquid, light, () => kiln, {update() { uploads++; return true; }}, proxy);
  assert.equal(active, expected, `bridge activation: liquid=${liquid} light=${light} kiln=${kiln} proxy=${proxy}`);
  assert.equal(uploads, Number(expected), 'native composition and fire Proxy must not upload the fire canvas into the scene');
}
assert.equal(evaluate(false, false, () => false, null, false), false);
console.log('volume kiln composition bridge: PASS');
