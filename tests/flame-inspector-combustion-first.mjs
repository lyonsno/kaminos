// kaminos-test: node
// Operator 2026-10-22: first panel groups combustion, temperature, soot and
// emission by phenomenon. October23: emission first, combined combustion/thermal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLAME_INSPECTOR_VIEWS, FLAME_PROPERTY_GROUPS } from '../flame-authoring.mjs';

const first = FLAME_INSPECTOR_VIEWS[0].id;
const firstGroups = FLAME_PROPERTY_GROUPS.filter(group => group.view === first);
assert.equal(firstGroups[0]?.name,'Emission & image','image controls lead the Material panel');
const combustion = firstGroups.find(group=>group.name==='Combustion');
assert.equal(combustion.open, true, 'and starts open');
const ids = combustion.fields.map(([id]) => id);
for (const id of ['volume-reaction-law', 'volume-reactant-mixing-time', 'volume-heat-release-expansion','volume-physical-kelvin-per-heat','volume-reactant-cooling-time']) {
  assert.ok(ids.includes(id), `${id} is in Combustion on the first panel`);
}
assert.equal(ids.at(-1),'volume-reaction-law','infrequent law selector follows thermal settings');
const everywhere = FLAME_PROPERTY_GROUPS.flatMap(group => group.fields.map(([id]) => id));
for (const id of ids) assert.equal(everywhere.filter(other => other === id).length, 1, `${id} appears once in the inspector`);
const emission=firstGroups.find(group=>group.name==='Emission & image');
assert.equal(emission.open,true);
assert.deepEqual(emission.fields.find(([id]) => id === 'volume-physical-thermal'), ['volume-physical-thermal', 'Glow gain'], 'the inspector calls it Glow gain');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(index, /<span class="slider-label" id="volume-physical-thermal-label">Glow gain<\/span>/, 'the cockpit calls it Glow gain from the start');
console.log('flame inspector combustion-first contracts passed');
