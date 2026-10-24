// kaminos-test: node
// Operator 2026-10-21: retire the controls that do nothing under the Physics
// law and the single Flame simulator: Smoke, Absorption, Fire, Pyro carrier
// view and Detail Scale. Saved basins still load (their values are stripped).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOLUME_CONTROL_DESCRIPTIONS } from '../volume-control-descriptions.mjs';
import { PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS } from '../volume-physics-appearance.mjs';

const RETIRED = ['volume-smoke', 'volume-absorption', 'volume-fire', 'volume-pyro-carrier-view', 'volume-detail-scale'];
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inspector = readFileSync(new URL('../flame-authoring.mjs', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../volume-cockpit-layout.mjs', import.meta.url), 'utf8');
for (const id of RETIRED) {
  assert.ok(!schema.controls.some(control => control.key === id), `${id} is no longer a live control`);
  assert.ok(schema.retiredControls.some(control => control.key === id && control.axis === 'domControls'), `${id} is a declared retirement, so saved basins strip it`);
  assert.doesNotMatch(index, new RegExp(`id="${id}"`), `${id} has no cockpit row`);
  assert.doesNotMatch(index, new RegExp(`getElementById\\('${id}'\\)`), `nothing reads ${id} from the page`);
  assert.doesNotMatch(index, new RegExp(`'${id}'`), `no id list names ${id}`);
  assert.doesNotMatch(inspector, new RegExp(`'${id}'`), `the flame inspector has no ${id} row`);
  assert.equal(VOLUME_CONTROL_DESCRIPTIONS[id], undefined, `${id} has no description`);
  assert.ok(!PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS.some(control => control.id === id), `${id} is not listed as a carrier control`);
}
assert.doesNotMatch(inspector, /name:'Legacy appearance'/, 'the inspector group that only held Absorption is gone');
assert.doesNotMatch(index, /setVolumeControlValue\(preset\.radiance/, 'the leftover radiance call (a value passed as an id) is gone');
assert.doesNotMatch(layout, /\['smoke', 'absorption'\]/, 'availability no longer manages the retired controls');
assert.equal(schema.controls.length, schema.controlCount);
console.log('inert control retirement contracts passed');
