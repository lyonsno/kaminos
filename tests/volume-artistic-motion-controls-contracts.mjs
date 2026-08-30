import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';


const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

for (const [id, param, controlKey] of [
  ['volume-artistic-swirl', 'volume_artistic_swirl', 'artisticSwirl'],
  ['volume-phased-sway', 'volume_phased_sway', 'phasedSway'],
]) {
  assert.match(
    index,
    new RegExp(`<input[^>]+type="checkbox"[^>]+id="${id}"[^>]+checked`),
    `${id} is a live default-on artistic switch`,
  );
  assert.deepEqual(
    schema.controls.find(control => control.key === id),
    { key: id, param, tagName: 'INPUT', type: 'checkbox' },
    `${id} is persisted by the strict preset inventory`,
  );
  assert.ok(
    index.includes(`${controlKey}: document.getElementById('${id}').checked`),
    `${id} reaches the runtime control snapshot`,
  );
  assert.ok(index.includes(`params.has('${param}')`), `${id} restores from an exact route`);
  assert.match(index, new RegExp(`'${controlKey}', '${param}'`), `${id} participates in snapshot routes`);
}

assert.match(core, /artistic_motion_controls:\s*vec4<f32>/, 'simulation uniforms own the two artistic gates');
assert.match(core, /uniforms\[364\] = controlsSnapshot\.artisticSwirl === false \? 0 : 1/);
assert.match(core, /uniforms\[365\] = controlsSnapshot\.phasedSway === false \? 0 : 1/);
assert.match(
  core,
  /vel = vel \+ \(swirl \* heat[\s\S]*?\* artisticSwirl;/,
  'Artistic Swirl gates only the authored macro rotation',
);
assert.match(core, /sin\(phase\)[^\n]+\* phasedSway;/, 'Phased Sway gates the X lateral phase force');
assert.match(core, /cos\(phase \* 0\.93\)[^\n]+\* phasedSway;/, 'Phased Sway gates the Z lateral phase force');
assert.match(
  core,
  /vel = vel \+ confinement \* \(0\.35 \+ smoke \* 0\.34 \+ heat \* 0\.52\);/,
  'base vorticity confinement remains independent of the artistic switches',
);
assert.match(core, /vel = vel \+ detailForce;/, 'base turbulent detail remains independent of the artistic switches');

console.log('volume artistic motion controls: independent live, route, preset, and simulation gates pass');
