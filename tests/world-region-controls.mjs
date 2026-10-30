// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorldRegions, REGION_CONTROL_FIELDS } from '../volume-region-controls.mjs';
test('independent region controls select the actual plans and pressure sweeps',()=>{
 const s=resolveWorldRegions({worldSmokeFlow:32,worldSmokeMaterial:16,worldSmokePressure:8,worldSmokeIterations:7,worldSmokeExtent:3,worldSmokeIntermediate:'fields',intermediateFlow:24,intermediateMaterial:48,intermediatePressure:12,intermediateIterations:0,intermediateExtent:1.5},[64,128,64]);
 assert.deepEqual(s.world.pressureDims,[8,16,8]);assert.equal(s.worldIterations,7);
 assert.deepEqual(s.middle.materialDims,[48,80,48]);assert.equal(s.middleIterations,0);
 assert.equal(s.middleMode,'fields');
 const old=resolveWorldRegions({worldSmokeIntermediate:'on'},[64,128,64]);
 assert.equal(old.middle.extraMaterialCells,0);assert.equal(old.worldIterations,16);
 assert.deepEqual(old.world.pressureDims,old.world.flowDims);
 assert.throws(()=>resolveWorldRegions({worldSmokeIterations:-1},[64,128,64]),/iterations/);
 assert.deepEqual(resolveWorldRegions({worldSmokePressure:7},[64,128,64]).world.pressureDims,[7,14,7]);
});

test('legacy mode keeps its original sixteen sweeps with additive control defaults',()=>{
 const controls=Object.fromEntries(REGION_CONTROL_FIELDS.map(c=>[c.key,c.value]));
 assert.equal(resolveWorldRegions({...controls,worldSmokeIntermediate:'on'},[32,64,32]).middleIterations,16);
});
