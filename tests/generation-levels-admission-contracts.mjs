// kaminos-test: node — a surfel-keyed levels request runs only on a levels module that declares the raw-decode
// reference; an older module would treat the surfel GLB as a hero mesh and register meaningless tiers
import test from 'node:test';import assert from 'node:assert/strict';
import {admitLevelsRequest} from '../generation-levels-admission.mjs';

test('a hero request is always admitted',()=>{assert.equal(admitLevelsRequest({},{source:'a'}),null);});
test('a raw-decode request on a module that does not declare it is skipped with a reason, not run as a hero request',()=>{
  const report=admitLevelsRequest({prepareGenerationLevels(){}},{source:'a',reference:'raw-decode'});
  assert.equal(report.phase,'skipped');assert.match(report.reason,/raw decode/);
});
test('a raw-decode request on a module that declares it is admitted',()=>{
  assert.equal(admitLevelsRequest({GENERATION_LEVEL_REFERENCES:['hero','raw-decode']},{source:'a',reference:'raw-decode'}),null);
});
