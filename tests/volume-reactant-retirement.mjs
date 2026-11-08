// kaminos-test: node
import assert from 'node:assert/strict';
import {APPEARANCE_MODELS,resolveAppearanceModel} from '../volume-core.js';
import {REACTION_LAWS,resolveReactantCombustionConfig} from '../volume-reactant-combustion.mjs';

assert.deepEqual(APPEARANCE_MODELS,['shred-only']);
assert.deepEqual(REACTION_LAWS,['reactant-v0']);
for(const requested of [undefined,'authored','compact-3','shred-only']){
  const resolved=resolveAppearanceModel(requested,{reactant:true,physics:true});
  assert.equal(resolved.effective,'shred-only');
  assert.deepEqual(resolved.storedCarriers,['interfaceShred']);
}
assert.equal(resolveReactantCombustionConfig({emitterSourceLaw:'immersed-source'}).effective.admitted,true);
