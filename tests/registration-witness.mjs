// kaminos-test: node
import assert from 'node:assert/strict';
import {assertRenderedEvidence} from '../tools/part-claims-witness-checks.mjs';
assert.throws(()=>assertRenderedEvidence({errors:[],console:[{type:'error',args:[{value:'Render pipeline creation failed'}]}]}),/render|console/i);
assert.throws(()=>assertRenderedEvidence({errors:[{exception:'bad'}],console:[]}),/exception/i);
assert.throws(()=>assertRenderedEvidence({errors:[],console:[]}),/WebGPU/i);
assertRenderedEvidence({errors:[],console:[{type:'log',args:[{value:'WebGPU renderer initialized, backend:'},{value:'WebGPUBackend'}]}]});
console.log('registration witness rejects renderer errors, exceptions and missing route');
