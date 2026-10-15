// kaminos-test: node
import assert from 'node:assert/strict';
import * as checks from '../tools/creature-controls-witness.mjs';
assert.equal(typeof checks.validateWanderObservation,'function','A claimed wander observation does not yet check actual registered area, source identity and root movement');
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const sample={source:{motionSha256:'motion',frameSha256:'bind'},placementMatrix:identity,boneWorld:[{name:'pelvis',matrix:[...identity.slice(0,12),2,0,3,1]}],registration:[{id:'area',objectVisible:true}],action:{kind:'wander',error:null,area:{id:'area',mounted:true},motion:{elapsed:2,cycle:1,sourceKey:'motion:bind',path:{distance:5,position:[2,3],direction:[0,1]}}}};
checks.validateWanderObservation(sample);
for(const change of [s=>s.action.kind='preview',s=>s.action.error='stopped',s=>s.action.area.mounted=false,s=>s.registration=[],s=>s.action.motion.sourceKey='old:source',s=>s.action.motion.path.position[0]=9,s=>s.boneWorld=[],s=>s.action.motion.elapsed=NaN]){
 const s=structuredClone(sample);change(s);assert.throws(()=>checks.validateWanderObservation(s));
}
assert.equal(typeof checks.validateWanderProgress,'function');
const before=structuredClone(sample),after=structuredClone(sample);after.action.motion.elapsed+=1;after.action.motion.cycle+=1;after.action.motion.path.distance+=2;after.action.motion.path.position[0]+=1;after.boneWorld[0].matrix[12]+=1;
checks.validateWanderProgress(before,after,{minimumCycles:1});
for(const change of [s=>s.action.motion.elapsed=2,s=>s.action.motion.cycle=1,s=>s.action.motion.path.distance=5,s=>{s.action.motion.path.position=[2,3];s.boneWorld[0].matrix[12]=2;}]){const s=structuredClone(after);change(s);assert.throws(()=>checks.validateWanderProgress(before,s,{minimumCycles:1}));}
console.log('Wander evidence rejects stale source, missing area, fake path-only movement and no completed cycle');
