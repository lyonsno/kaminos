import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as occupancy from '../scratch/beaming-occupancy-visibility.mjs';
import {validateSplitRays,validateVisibilitySample} from '../scratch/beaming-bounded-comparison.mjs';
assert.equal(typeof occupancy.instrumentOccupancySplit,'function','split must instrument the real gather module');
const source=await fs.readFile(new URL('../scene-volume-gather.mjs',import.meta.url),'utf8');
const result=occupancy.instrumentOccupancySplit(source,128);
for(const token of ["'occupancy-split'",'fn cacheNearGeometry','fn cacheFarGeometry','nearResults[address]=vec4<f32>',"label:'exact near-receiver visibility'","label:'far occupancy visibility'",'readVisibilitySplit'])assert(result.includes(token),token);
assert(result.includes("label:'static kiln visibility preparation'"),'fused control retained');
assert(result.includes('if(near.w!=1.0){firstHits[address]=near.x;return;}'),'far pass must preserve exact near-hit gating');
assert(result.includes('nearResults[address]=vec4<f32>(closest,closest,closest,-1.0)'),'source misses must overwrite stale intermediate state');
assert.throws(()=>occupancy.instrumentOccupancySplit(source.replace('fn cacheGeometry','fn missingGeometry'),128),/seam/);
const hits=new Float32Array([1e20,.125,.75,2]),near=new Float32Array([1e20,1e20,1e20,-1,.125,2,.25,0,.25,2,.25,1,.25,2,.25,1]);
assert.deepEqual(validateSplitRays(hits,hits,near,4),{rays:4,sourceMiss:1,nearBlocked:1,farEligible:2,farBlocked:1,farUnblocked:1});
for(const mutate of [a=>a[3]=2,a=>a[4]=0,a=>a[6]=0,a=>a[8]=0,a=>a[9]=.5,a=>a[15]=0,a=>a[1]=NaN]){const changed=near.slice();mutate(changed);assert.throws(()=>validateSplitRays(hits,hits,changed,4));}
assert.throws(()=>validateSplitRays(hits,new Float32Array([1e20,.125,.8,2]),near,4));
assert.throws(()=>validateSplitRays(hits,hits,new Float32Array(16),4),'blank records cannot pass');
assert.throws(()=>validateSplitRays(hits,hits,near,5),'missing rays cannot pass');
const sample={metadata:{visibilityBounds:'occupancy-split',generation:7,directions:8,angularPattern:'guided',angularCache:{counts:[8],visibilityPreparations:3}},before:{encodes:1,pipelines:4,rayBuffers:1},after:{encodes:2,pipelines:4,rayBuffers:1},profile:{errors:[],records:[{valid:true,totalMs:3,passes:[{label:'exact near-receiver visibility',ms:1},{label:'far occupancy visibility',ms:1}]}]}};
const identity={mode:'occupancy-split',generation:7,preparations:3};assert(validateVisibilitySample(sample,identity));
for(const mutate of [s=>s.profile.records[0].passes.pop(),s=>s.profile.records[0].passes[0].ms=NaN,s=>s.metadata.visibilityBounds='occupancy',s=>s.profile.records[0].passes.push({label:'static kiln visibility preparation',ms:1})]){const changed=structuredClone(sample);mutate(changed);assert.throws(()=>validateVisibilitySample(changed,identity));}
console.log('real gather split instrumentation, gating and stale-source overwrite contracts pass');
