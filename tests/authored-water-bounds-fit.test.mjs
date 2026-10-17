// kaminos-test: node
import assert from 'node:assert/strict';
import * as water from '../authored-water-drop.mjs';
assert.equal(typeof water.planAuthoredWaterBounds,'function','An out-of-bounds drop needs an explicit bounds recovery plan');
const records=[{id:'A',label:'Water drop',transform:{position:[-.32822008927444135,.9434043045005729,.3260759065851606],rotation:[0,0,0],scale:[.9513777777777778,.9513777777777778,.9513777777777778]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.6,samplesPerUnit:20}}},{id:'B',label:'Water drop 2',transform:{position:[1.8420186719332063,.826321558434195,-.24294035047379348],rotation:[0,0,0],scale:[.5533333333333333,.5533333333333333,.5533333333333333]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.6,samplesPerUnit:20}}}];
const sampling=water.resolveAuthoredWaterSampling(records,{waterSampling:{spacing:.0375,particleTarget:20425,container:{min:[-2,-1,-2],max:[2,3,2]}}}),original=JSON.stringify(records);
assert.equal(water.inspectAuthoredWaterCompatibility(records,sampling).compatible,false,'Captured working scene reproduces disabled Play');
const plan=water.planAuthoredWaterBounds(records,sampling);
assert.equal(plan.changed,true);assert.ok(plan.bounds.max[0]>2);assert.deepEqual(plan.bounds.min,[-2,-1,-2]);assert.equal(plan.bounds.max[1],3);assert.equal(plan.bounds.max[2],2);
assert.equal(plan.sampling.particleTarget,20425);assert.equal(plan.sampling.spacing,sampling.spacing);assert.equal(JSON.stringify(records),original,'Planning preserves placed source state');
assert.equal(water.inspectAuthoredWaterCompatibility(records,plan.sampling).compatible,true);
for(const r of records){const before=water.describeAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,sampling),after=water.createAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,plan.sampling);assert.equal(after.particleCount,before.particleCount);assert.equal(after.width,before.width);assert.equal(after.box.collisions,true);}
assert.equal(water.planAuthoredWaterBounds(records,plan.sampling).changed,false,'Fitting twice is idempotent');
const rotated=structuredClone(records);rotated[1].transform.position=[4,1,0];rotated[1].transform.rotation=[.3,.7,.2];
for(const container of [sampling.container,null]){const config={...sampling,container,...(container===null?{worldBounds:sampling.container}:{})},p=water.planAuthoredWaterBounds(rotated,config);assert.equal(p.sampling.container===null,container===null);for(const r of rotated)water.createAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,p.sampling);}
console.log('Captured bounds blocker has explicit expanding-only, pose/count-preserving, idempotent recovery');
