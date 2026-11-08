// kaminos-test: node
import assert from 'node:assert/strict';
import {deformationTrace} from '../experiments/hand-replay-guide.mjs';
const hand=(length,width)=>{const joints=Array.from({length:21},()=>[0,0,0]);joints[9]=[0,length,0];joints[5]=[-width/2,0,0];joints[17]=[width/2,0,0];return {status:'observed',joints};};
const data={models:[{id:'size',label:'size'},{id:'joint',label:'joint'}],frames:[{timeMs:0,hands:[hand(.09,.06),hand(.08,.05)]},{timeMs:50,hands:[hand(.10,.06),{status:'missing',reason:'unavailable'}]}]};
const lengths=deformationTrace(data,0,1,0,[0,1],'palmLength');
assert.deepEqual(lengths.series.map(s=>s.points.map(p=>p.value)),[[90,100],[80,null]]);
const ratios=deformationTrace(data,0,1,0,[0,1],'palmRatio');
assert(Math.abs(ratios.series[0].points[0].value-1.5)<1e-12);
assert.equal(ratios.series[1].points[1].value,null);
assert.deepEqual(data.frames[0].hands[0].joints[9],[0,.09,0]);
console.log('raw palm length and proportion traces passed');
