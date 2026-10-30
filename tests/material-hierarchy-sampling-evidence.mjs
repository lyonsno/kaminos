// kaminos-test: node
import assert from 'node:assert/strict';
import {validateSamplingEvidence} from '../experiments/material-hierarchy/sampling.mjs';
const example=()=>({cases:['mixed-levels','partial-fractional','translated-small-cells'].map(name=>({name,points:[[0,0,0]],values:Array(16).fill(1)}))});
assert.equal(validateSamplingEvidence(example()).maximumError,0);
for(const change of [r=>r.cases.pop(),r=>r.cases[0].name='wrong',r=>r.cases[0].values.pop(),r=>r.cases[0].values[1]=NaN,r=>r.cases[0].values.fill(0),r=>r.cases[0].values[0]=2,r=>r.error='validation failed']){
 const result=example();change(result);assert.throws(()=>validateSamplingEvidence(result));
}
console.log('Sampler evidence rejects missing, wrong, partial, non-finite, blank and divergent results');
