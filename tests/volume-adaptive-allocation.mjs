// kaminos-test: node
import assert from 'node:assert/strict';
import { supportBoxes, activeBricks, compareFields } from '../experiments/allocation/model.mjs';
const c={size:16,brick:4,velocity:[1.25,-.25,0],boxes:[{lo:[4,4,4],hi:[6,6,6]}]};
assert.deepEqual(supportBoxes(c,2),[{lo:[6,2,4],hi:[10,6,6]}]);
assert.deepEqual(activeBricks(c,0),[21]);
assert.deepEqual(activeBricks(c,2),[17,18,21,22]);
assert.throws(()=>compareFields(new Float32Array([1]),new Float32Array([NaN])),/nonfinite/);
assert.throws(()=>compareFields(new Float32Array([1]),new Float32Array([])),/length/);
assert.equal(compareFields(new Float32Array([1,2]),new Float32Array([1,3])).maxError,1);
console.log('allocation support and field checks passed');
import {validateSignal} from '../experiments/allocation/model.mjs';
const config={...c,steps:2,repeats:1};
const good={adapter:{vendor:'apple',fallback:false},errors:[],validation:null,rows:[{config,samples:[{parity:{maxError:0,referenceMass:1},active:4,overflow:0,denseMs:[1,1],allocationMs:[1,1],sparseUpdateMs:[1,1]}]}]};
assert.equal(validateSignal(good,[config]),true);
for(const mutate of [r=>r.adapter.fallback=true,r=>r.rows=[],r=>r.rows[0].config.size=32,r=>r.rows[0].samples=[],r=>r.rows[0].samples[0].denseMs=[],r=>r.rows[0].samples[0].parity.referenceMass=0,r=>r.rows[0].samples[0].parity.maxError=NaN,r=>r.rows[0].samples[0].overflow=1]){
 const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateSignal(bad,[config]));
}
console.log('invalid, blank, fallback, partial and mismatched evidence rejected');
