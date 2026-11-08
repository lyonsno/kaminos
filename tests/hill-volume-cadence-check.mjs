// kaminos-test: node
import assert from 'node:assert/strict';import {checkHillCadence} from '../tools/hill-volume-cadence-check.mjs';
const sample={hardware:{vendor:'apple',isFallbackAdapter:false},effective:{fixture:'hundred-rocks',bodyCount:100,dt:.0015},frameCount:2,frames:[{physicalSteps:5,beforeSteps:0,afterSteps:5,drawn:true,wallMs:4},{physicalSteps:6,beforeSteps:5,afterSteps:11,drawn:true,wallMs:5}],natural:{hostTimes:[0,8.33,16.66],startSteps:11,endSteps:22,elapsedMs:16.66,playing:false}};
for(const mutate of [r=>r.hardware.isFallbackAdapter=true,r=>r.effective.fixture='outcrop',r=>r.frames.pop(),r=>r.frames[0].drawn=false,r=>r.frames[1].afterSteps=5,r=>r.frames[0].wallMs=NaN,r=>r.natural.hostTimes=[],r=>r.natural.endSteps=r.natural.startSteps]){
 const r=structuredClone(sample);mutate(r);assert.throws(()=>checkHillCadence(r),'Wrong route, blank/partial/cached frame or missing advancement must fail');
}
assert.doesNotThrow(()=>checkHillCadence(sample));
