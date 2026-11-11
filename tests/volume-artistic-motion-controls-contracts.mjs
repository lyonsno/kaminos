// kaminos-test: node
import {assertCalibratedFireNumerics} from './helpers/calibrated-fire-native.mjs';
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

console.log('volume artistic motion controls: independent live, route, preset, and simulation gates pass');

await assertCalibratedFireNumerics();
