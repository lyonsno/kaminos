import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';


const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

assert.match(
  index,
  /<select[^>]+id="emitter-assay-family"[^>]+data-volume-settings-param="volume_emitter_family"/,
  'the pre-volume-* emitter id declares its canonical settings-route parameter explicitly',
);
assert.match(
  index,
  /function volumeDomControlParamFromElement\(el\)[\s\S]*?el\.dataset\.volumeSettingsParam[\s\S]*?volumeDomControlParamFromId\(el\.id\)/,
  'preset capture prefers an explicit route parameter and preserves the volume-* convention as fallback',
);

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
    { key: id, param, tagName: 'INPUT', type: 'checkbox', additiveDefault: true },
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
assert.match(
  core,
  /if \(transportedLateralExcitationEnabled > 0\.5\) \{[\s\S]*?let transportedLateralDelta = prev\.xz - advected\.xz;/,
  'the legacy phased-sway route now gates transported lateral variation instead of imposing a phase wave',
);
assert.doesNotMatch(core, /let phasedSway\b|sin\(phase\) \* \(smoke \+ heat\)|cos\(phase \* 0\.93\)/, 'the simulation retains no phased-sway force authority while the persisted route key survives');
assert.match(
  core,
  /vel = vel \+ confinement \* \(0\.35 \+ smoke \* 0\.34 \+ heat \* 0\.52\);/,
  'base vorticity confinement remains independent of the artistic switches',
);
assert.match(core, /vel = vel \+ detailForce;/, 'base turbulent detail remains independent of the artistic switches');

console.log('volume artistic motion controls: independent live, route, preset, and simulation gates pass');
