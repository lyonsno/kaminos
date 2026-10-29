// kaminos-test: node
import assert from 'node:assert/strict';import * as contract from '../tools/fracture-whole-response-contract.mjs';
assert.equal(typeof contract.assertResidentFrameTransfers,'function','Resident frame evidence must reject transfers and incomplete observations');
const baseline={maps:[],fences:0,devices:[{vendor:'apple',fallback:false}]};
contract.assertResidentFrameTransfers(baseline,structuredClone(baseline));
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{...baseline,maps:[{bytes:16,label:'Pointer-down contact result'}]}),/acquired/,'Even small maps during ordinary frames invalidate the claim');
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{...baseline,fences:1}),/completion/);
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{maps:[],fences:0,devices:[{vendor:'google',fallback:true}]}),/Native/);
assert.throws(()=>contract.assertResidentFrameTransfers(baseline,{}),/observation/);
const pull={accepted:true,before:{material:{step:1,bodies:[{position:{x:0,y:0,z:0}}]}},inputs:[{type:'pointerdown',trusted:true,x:0,y:0,at:0},{type:'pointermove',trusted:true,x:10,y:0,at:25},{type:'pointerup',trusted:true,x:10,y:0,at:50}],commands:[{active:[0],at:1},{active:[],at:51}],state:{material:{step:2,hand:null,samples:[{step:2,handActive:true,handContact:{x:0,y:0,z:0},handTarget:{x:.1,y:0,z:0}}],bodies:[{position:{x:.01,y:0,z:0}}]}}};
contract.assertShortPullResponse(pull);
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,step:1,samples:[]}}}),/physical/,'A contact alone cannot prove a response');
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,hand:{index:0}}}}),/hand/);
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,samples:[{step:2,handActive:false}]}}}),/loaded/);
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,bodies:pull.before.material.bodies}}}),/move/);
assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,bodies:[{position:{x:NaN,y:0,z:0}}]}}}),/finite/);

assert.throws(()=>contract.assertShortPullResponse({...pull,state:{material:{...pull.state.material,samples:[{step:2,handActive:true,handContact:{x:0,y:0,z:0},handTarget:{x:0,y:0,z:0}}]}}}),/moved target/,"Contact settling is not submitted pulling");

assert.throws(()=>contract.assertShortPullResponse({...pull,commands:[{active:[0],at:1},{active:[],at:20}]}),/cleared before/);
assert.throws(()=>contract.assertShortPullResponse({...pull,inputs:pull.inputs.filter(e=>e.type!=="pointermove").map(e=>({...e,x:0}))}),/recorded movement/);
assert.throws(()=>contract.assertShortPullResponse({...pull,inputs:[...pull.inputs,{type:"lostpointercapture",at:20}]}),/cancelled/);

const observed=JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/fracture-short-pull-contact-only.json',import.meta.url),'utf8'));
assert.throws(()=>contract.assertShortPullResponse(observed),/moved target/,'The actual contact-only native row must remain rejected');
