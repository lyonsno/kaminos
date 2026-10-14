import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const index = read('index.html');
const core = read('volume-core.js');
const witness = read('volume-witness.mjs');
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

for (const [id, route, requested, shader, lane, initial] of [
  ['volume-interface-shred', 'routeInterfaceShred', 'requestedInterfaceShred', 'shredAmount', 'z', '2.5'],
  ['volume-fire-licks', 'routeFireLicks', 'requestedFireLicks', 'fireLickAmount', 'w', '1.65'],
]) {
  const input = index.match(new RegExp(`<input[^>]+id="${id}"[^>]+>`))?.[0];
  assert.ok(input, `${id} exists`);
  assert.equal(Number(input.match(/max="([^"]+)"/)[1]), 10, `${id} admits the requested doubled ceiling`);
  assert.match(input, /min="0"/);
  assert.match(input, /step="0\.05"/);
  assert.ok(input.includes(`value="${initial}"`), `${id} retains its default`);
  const routeCap = Number(index.match(new RegExp(`Math\\.min\\((\\d+), ${route}\\)`))?.[1]);
  const witnessCap = Number(witness.match(new RegExp(`Math\\.min\\((\\d+), ${requested}\\)`))?.[1]);
  const shaderCap = Number(core.match(new RegExp(`let ${shader} = clamp\\(u\\.grid_overlay_debug\\.${lane}, 0\\.0, ([\\d.]+)\\)`))?.[1]);
  for (const [path, cap] of [['URL', routeCap], ['witness', witnessCap], ['shader', shaderCap]]) {
    assert.equal(cap, 10, `${id} ${path} preserves the expanded range`);
    for (const value of [0, 1.65, 2.5, 5, 7.5, 10]) assert.equal(clamp(value, 0, cap), value);
    assert.equal(clamp(11, 0, cap), 10);
    assert.equal(clamp(-1, 0, cap), 0);
  }
}

const helper = core.match(/function fireLickOperatorGainFromAmount\(value\) \{([\s\S]*?)\n}/)?.[1];
assert.ok(helper, 'live JS operator-gain helper exists');
const gain = new Function('clampFinite', 'value', helper).bind(null, (v, lo, hi, fallback) => Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : fallback);
for (const value of [0, 1.65, 2.5, 5, 7.5, 10]) {
  assert.equal(gain(value), value * (0.82 + value * 0.110), 'existing gain law continues through ten');
}
assert.equal(gain(11), gain(10));
assert.equal(gain(-1), 0);
assert.equal(gain(NaN), 0);
assert.match(core, /let shredOperatorGain = shredAmount \* \(0\.80 \+ shredAmount \* 0\.080\);/);
assert.match(core, /let fireLickOperatorGain = fireLickAmount \* \(0\.82 \+ fireLickAmount \* 0\.110\);/);
console.log('detail control range: UI, route, witness, shader and JS gain accept 0–10; defaults and old gain law preserved');
