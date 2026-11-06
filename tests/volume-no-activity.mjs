// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {APPEARANCE_MODELS, resolveAppearanceModel, appearanceModelUniformValue} from '../volume-core.js';

test('no activity is admitted only for Reactant/Physics, without changing default or packed layout', () => {
  assert.ok(APPEARANCE_MODELS.includes('no-activity'));
  const model = resolveAppearanceModel('no-activity', {reactant:true,physics:true});
  assert.equal(model.effective,'no-activity');
  assert.deepEqual(model.storedCarriers,[]);
  assert.deepEqual(model.transportedSlots,[0,1]);
  assert.equal(model.storedSlots,4);
  assert.equal(appearanceModelUniformValue('no-activity'),0);
  assert.equal(resolveAppearanceModel().effective,'authored');
  assert.equal(resolveAppearanceModel('no-activity',{physics:true}).reason,'no-activity-requires-the-reactant-law');
  assert.equal(resolveAppearanceModel('no-activity',{reactant:true}).reason,'no-activity-requires-physics-appearance');
});

test('no activity round-trips through the basin control schema', () => {
  const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
  assert.ok(schema.controls.find(c=>c.key==='volume-appearance-model').allowedValues.includes('no-activity'));
});
