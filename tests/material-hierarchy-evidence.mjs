// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateNativeEvidence} from '../experiments/material-hierarchy/acceptance.mjs';
// A local policy fixture; the optional argument replays preserved native data.
const fixture={errors:[],reference:[Array(512).fill(1),Array(512).fill(1)],steps:Array.from({length:6},(_,i)=>({
 error:null,allocatedBricks:1,capacity:1,levels:[{level:i===3?0:1,bricks:1}],totals:Array(8).fill(64),
 snapshot:{nodes:[{slot:0,pitch:1,level:i===3?0:1,lo:[0,0,0]}],values:Array(512).fill(1),dims:[4,4,4],pitch:1},
}))};
const check=value=>validateNativeEvidence(value,{fieldLength:512});
assert.equal(check(structuredClone(fixture)).referenceMaxError,0);
function rejects(label,mutate,reason){const value=structuredClone(fixture);mutate(value);assert.throws(()=>check(value),reason,label);}
rejects('non-finite reference',r=>r.reference[1][0]=NaN,/finite/);
rejects('empty reference',r=>r.reference=[[],[]],/length/);
rejects('partial reference',r=>r.reference[0].pop(),/length/);
rejects('extra reference',r=>r.reference[1].push(1),/length/);
rejects('missing reference pair',r=>r.reference.pop(),/reference/);
rejects('non-finite total',r=>r.steps[2].totals[1]=NaN,/finite/);
rejects('partial totals',r=>r.steps[2].totals.pop(),/length/);
rejects('non-finite pool',r=>r.steps[2].snapshot.values[0]=Infinity,/finite/);
rejects('partial pool',r=>r.steps[2].snapshot.values.pop(),/length/);
rejects('missing allocation step',r=>r.steps.pop(),/steps/);
rejects('absent snapshot',r=>delete r.steps[0].snapshot,/snapshot/);
rejects('untrustworthy slot',r=>r.steps[0].snapshot.nodes[0].slot=-1,/slot/);
rejects('non-finite pitch',r=>r.steps[0].snapshot.nodes[0].pitch=NaN,/pitch/);
rejects('wrong reference',r=>r.reference[1][0]=2,/differs/);
rejects('changed quantity',r=>r.steps[1].totals[1]=100,/quantity/);
rejects('GPU validation failure',r=>r.errors.push('validation failed'),/validation failed/);
if(process.argv[2]){
 const observed=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 const fieldLength=observed.steps[0].snapshot.dims.reduce((a,b)=>a*b,8);
 validateNativeEvidence(observed,{fieldLength});
 console.log('Preserved native evidence accepted:',fieldLength,'values per reference; max error',observed.referenceMaxError);
}
console.log('Native evidence shape, finiteness and tolerance acceptance passed');
