// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateSamplingEvidence,samplingFixtures,samplingReferenceRevision} from '../experiments/material-hierarchy/sampling.mjs';
const example=()=>({reference:samplingReferenceRevision,cases:samplingFixtures().map(({capacity,...spec})=>({...spec,values:Array(spec.points.length*16).fill(1)}))});
assert.equal(validateSamplingEvidence(example()).maximumError,0);
for(const change of [r=>r.reference='wrong',r=>r.cases.pop(),r=>r.cases[0].name='wrong',r=>r.cases[0].pitch*=2,r=>r.cases[0].dims[0]++,r=>r.cases[0].min[0]++,r=>r.cases[0].nodes[0].childSlots[0]++,r=>r.cases[0].values.pop(),r=>r.cases[0].values[1]=NaN,r=>r.cases[0].values.fill(0),r=>r.cases[0].values[0]=2,r=>r.error='validation failed']){
 const result=example();change(result);assert.throws(()=>validateSamplingEvidence(result));
}
// A shortened list and equally shortened result must not redefine coverage.
function rejectLostCoverage(observed){
 assert.equal(validateSamplingEvidence(observed).samples,2646);
 const reduced=structuredClone(observed);
 for(const c of reduced.cases){const p=c.points.findIndex((_,i)=>c.values[i*16+8]>0);c.points=c.points.slice(p,p+1);c.values=c.values.slice(p*16,(p+1)*16);}
 assert.throws(()=>validateSamplingEvidence(reduced),/probe|coverage/i,'paired omission must fail');
 const duplicate=structuredClone(observed);duplicate.cases[0].points[1]=duplicate.cases[0].points[0];duplicate.cases[0].values.splice(16,16,...duplicate.cases[0].values.slice(0,16));
 assert.throws(()=>validateSamplingEvidence(duplicate),/probe|coverage/i,'duplicate replacement must fail');
}
rejectLostCoverage(example());
if(process.argv[2])rejectLostCoverage(JSON.parse(fs.readFileSync(process.argv[2],'utf8')).sampling);
console.log('Sampler evidence rejects wrong identity, lost probe coverage, partial, non-finite, blank and divergent results');
