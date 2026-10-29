// kaminos-test: node
import assert from 'node:assert/strict';import * as contract from '../tools/fracture-whole-response-contract.mjs';
assert.equal(typeof contract.assertResidentFrameTransfers,'function','Resident frame evidence must reject transfers and incomplete observations');
const baseline={maps:[],fences:0,devices:[{vendor:'apple',fallback:false}]};
contract.assertResidentFrameTransfers(baseline,structuredClone(baseline));
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{...baseline,maps:[{bytes:16,label:'Pointer-down contact result'}]}),/acquired/,'Even small maps during ordinary frames invalidate the claim');
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{...baseline,fences:1}),/completion/);
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{maps:[],fences:0,devices:[{vendor:'google',fallback:true}]}),/Native/);
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{}),/observation/);
