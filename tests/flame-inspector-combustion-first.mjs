// kaminos-test: node
// Operator 2026-10-21: with Fire & smoke selected, the combustion controls
// (reaction law, mixing time, cooling time, soot yield, heat release) and Glow
// gain are on the first panel, open, and Glow gain has one name everywhere.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLAME_INSPECTOR_VIEWS, FLAME_PROPERTY_GROUPS } from '../flame-authoring.mjs';

const first = FLAME_INSPECTOR_VIEWS[0].id;
const firstGroups = FLAME_PROPERTY_GROUPS.filter(group => group.view === first);
const combustion = firstGroups[0];
assert.equal(combustion?.name, 'Combustion', 'Combustion is the first group on the first panel');
assert.equal(combustion.open, true, 'and starts open');
const ids = combustion.fields.map(([id]) => id);
for (const id of ['volume-reaction-law', 'volume-reactant-mixing-time', 'volume-reactant-cooling-time', 'volume-reactant-soot-yield', 'volume-heat-release-expansion', 'volume-physical-thermal']) {
  assert.ok(ids.includes(id), `${id} is in Combustion on the first panel`);
}
const everywhere = FLAME_PROPERTY_GROUPS.flatMap(group => group.fields.map(([id]) => id));
for (const id of ids) assert.equal(everywhere.filter(other => other === id).length, 1, `${id} appears once in the inspector`);
assert.deepEqual(combustion.fields.find(([id]) => id === 'volume-physical-thermal'), ['volume-physical-thermal', 'Glow gain'], 'the inspector calls it Glow gain');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(index, /<span class="slider-label" id="volume-physical-thermal-label">Glow gain<\/span>/, 'the cockpit calls it Glow gain from the start');
console.log('flame inspector combustion-first contracts passed');
