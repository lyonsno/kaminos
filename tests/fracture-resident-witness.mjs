// kaminos-test: node
import assert from 'node:assert/strict';import * as contract from '../tools/fracture-whole-response-contract.mjs';
assert.equal(typeof contract.assertResidentFrameTransfers,'function','Resident frame evidence must reject transfers and incomplete observations');
const baseline={maps:[],fences:0,devices:[{vendor:'apple',fallback:false}]};
contract.assertResidentFrameTransfers(baseline,structuredClone(baseline));
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{...baseline,maps:[{bytes:16,label:'Pointer-down contact result'}]}),/acquired/,'Even small maps during ordinary frames invalidate the claim');
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{...baseline,fences:1}),/completion/);
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{maps:[],fences:0,devices:[{vendor:'google',fallback:true}]}),/Native/);
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{}),/observation/);
const pull={accepted:true,before:{material:{step:1,bodies:[{position:{x:0,y:0,z:0}}]}},commands:[{active:[0]}],state:{material:{step:2,hand:null,samples:[{step:2,handActive:true}],bodies:[{position:{x:.01,y:0,z:0}}]}}};
contract.assertShortPullResponse(pull);
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,step:1,samples:[]}}}),/physical/,'A contact alone cannot prove a response');
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,hand:{index:0}}}}),/hand/);
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,samples:[{step:2,handActive:false}]}}}),/loaded/);
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,bodies:pull.before.material.bodies}}}),/move/);
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,bodies:[{position:{x:NaN,y:0,z:0}}]}}}),/finite/);
