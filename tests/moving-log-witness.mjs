// kaminos-test: node
// kaminos-test: node
import assert from 'node:assert/strict';
import {checkMovingLogEvidence} from '../tools/moving-log-contracts.mjs';
const frame=(name,shift,step)=>({name,resets:1,allocation:'live-1',burn:.2,state:{burner:false,motion:{runtimeReadbacks:0},followingDomain:{translation:[shift/16,0,0],shifts:shift},fields:[{steps:step}]}});
const source={kernel:{status:'passed'},effective:{backend:'WebGPU:apple',dimensions:[32,32,32],rays:28,radius:.1,gi:{steps:4,slices:3}},errors:[],frames:[frame('burner-off',0,720),frame('carried',16,840),frame('turned',20,870),frame('stationary',20,900)]};
assert.equal(checkMovingLogEvidence(source),true);
for(const edit of [
 r=>r.effective.backend='CPU',r=>r.effective.dimensions=[48,48,48],r=>r.effective.rays=64,r=>r.frames.pop(),
 r=>r.frames[1].burn=0,r=>r.frames[1].resets++,r=>r.frames[1].allocation='new',r=>r.frames[1].state.followingDomain.translation=[0,0,0],
 r=>r.frames[1].state.fields[0].steps=0,r=>r.errors.push('device lost'),r=>r.frames[3]=r.frames[2],r=>r.frames[1].burn=NaN,
]){const report=structuredClone(source);edit(report);assert.throws(()=>checkMovingLogEvidence(report));}
