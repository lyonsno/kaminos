// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateMovingEvidence} from '../experiments/material-hierarchy/moving-acceptance.mjs';
const fixture={plan:{materialPitch:.5},frames:Array.from({length:18},(_,step)=>({step,
 state:{capacity:1,allocatedBricks:1,revision:step},snapshot:{nodes:[{slot:0,lo:[step*.2,0,0],pitch:.25,level:1}],values:Array.from({length:512},(_,i)=>i%8===2||i%8===4?.1:0)},
}))};
assert.ok(validateMovingEvidence(fixture).burnTravel>2);
function rejects(label,mutate,reason){const data=structuredClone(fixture);mutate(data);assert.throws(()=>validateMovingEvidence(data),reason,label);}
rejects('moving material without refinement',r=>r.frames.at(-1).snapshot.nodes[0].level=0,/refinement/);
rejects('missing frames',r=>r.frames.pop(),/frames/);
rejects('repeated frame',r=>r.frames[4].step=3,/stale/);
rejects('partial field',r=>r.frames[4].snapshot.values.pop(),/length/);
rejects('non-finite field',r=>r.frames[4].snapshot.values[4]=NaN,/finite/);
rejects('dead pocket',r=>r.frames[4].snapshot.values.fill(0),/burning material/);
rejects('stationary pocket',r=>r.frames.forEach(f=>f.snapshot.nodes[0].lo[0]=0),/cross/);
rejects('stationary refinement mask',r=>r.frames.forEach((f,i)=>{
 f.state.capacity=2;f.state.allocatedBricks=2;
 f.snapshot.nodes=[{slot:0,lo:[0,0,0],pitch:.25,level:1},{slot:1,lo:[4,0,0],pitch:.25,level:1}];
 f.snapshot.values=Array.from({length:1024},(_,k)=>k%8===2?.1:k%8===4?((k<512?17-i:i)/17)*.1:0);
}),/refinement stayed/);
if(process.argv[2]){
 const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 console.log(JSON.stringify(validateMovingEvidence(data.moving),null,2));
}
console.log('Moving evidence rejects missing, stale, invalid and untracked material');
