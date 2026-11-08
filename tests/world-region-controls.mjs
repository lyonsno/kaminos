// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorldRegions, REGION_CONTROL_FIELDS } from '../volume-region-controls.mjs';
test('independent World controls select actual pressure dimensions and sweeps',()=>{
 const c={worldSmokeFlow:32,worldSmokeMaterial:16,worldSmokePressure:8,worldSmokeIterations:7,worldSmokeExtent:3};
 const s=resolveWorldRegions(c,[64,128,64]);
 assert.deepEqual(s.world.pressureDims,[8,16,8]);assert.equal(s.worldIterations,7);
 assert.deepEqual(resolveWorldRegions({...c,worldSmokeIntermediate:'fields',intermediateFlow:24,intermediateMaterial:48,intermediatePressure:12,intermediateIterations:0,intermediateExtent:1.5},[64,128,64]),s);
 const old=resolveWorldRegions({worldSmokeIntermediate:'on'},[64,128,64]);
 assert.equal(old.worldIterations,16);assert.equal(Object.hasOwn(old,'middle'),false);
 assert.deepEqual(old.world.pressureDims,old.world.flowDims);
 assert.throws(()=>resolveWorldRegions({worldSmokeIterations:-1},[64,128,64]),/iterations/);
 assert.deepEqual(resolveWorldRegions({worldSmokePressure:7},[64,128,64]).world.pressureDims,[7,14,7]);
});
test('control defaults describe Fine and World only',()=>{
 const controls=Object.fromEntries(REGION_CONTROL_FIELDS.map(c=>[c.key,c.value]));
 assert.equal(resolveWorldRegions(controls,[32,64,32]).worldIterations,16);
 assert.equal(REGION_CONTROL_FIELDS.some(c=>c.key.startsWith('intermediate')),false);
});
