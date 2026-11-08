// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {APPEARANCE_MODELS,resolveAppearanceModel,appearanceModelUniformValue} from '../volume-core.js';
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
assert.deepEqual(APPEARANCE_MODELS,['shred-only']);
assert.deepEqual(schema.controls.find(c=>c.key==='volume-appearance-model').allowedValues,['shred-only']);
for(const requested of ['authored','compact-3','shred-only',undefined]){
 const mode=resolveAppearanceModel(requested,{reactant:true,physics:true});
 assert.equal(mode.effective,'shred-only');
 assert.equal(appearanceModelUniformValue(mode.effective),0);
 assert.deepEqual(mode.storedCarriers,['interfaceShred']);
 assert.deepEqual(mode.transportedSlots,[0,1,3]);
 assert.equal(mode.storedSlots,4,'compatible physical/Shred storage, not compact carrier synthesis');
}
