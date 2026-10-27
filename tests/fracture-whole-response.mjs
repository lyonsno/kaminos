// kaminos-test: node
import assert from 'node:assert/strict';import {assertWholeObjectAtRest,assertGrabbedMaterialFractures,waitForWholeObjectIdle,assertReleasedMaterialAdvances} from '../tools/fracture-whole-response-contract.mjs';
const pose=x=>({position:{x,y:0,z:0},quaternion:{x:0,y:0,z:0,w:1},velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}});
const material={broken:0,step:4,hand:{index:0},bodies:[pose(0),pose(1),pose(2),pose(3)],bonds:[{id:'loaded',a:0,b:1,alive:true},{id:'elsewhere',a:2,b:3,alive:true}],events:[],config:{strength:10}},before={material},after={material:{...material,step:5,broken:1,events:[{id:'elsewhere',kind:'crack',step:5,handActive:true,reaction:20,stress:20}]}};
assert.throws(()=>assertGrabbedMaterialFractures({before,after}),/grabbed material load path/,'A fracture elsewhere must not masquerade as successful manipulation');
after.material.events[0].id='loaded';assert.deepEqual(assertGrabbedMaterialFractures({before,after}).loadedCracks,['loaded']);
after.material.events[0].handActive=false;assert.throws(()=>assertGrabbedMaterialFractures({before,after}),/grabbed material load path/);
const initial={material:{...material,hand:null}},unloaded={material:{...material,hand:null,step:24}};assertWholeObjectAtRest({initial,unloaded});unloaded.material.broken=1;assert.throws(()=>assertWholeObjectAtRest({initial,unloaded}),/without an applied hand/);unloaded.material.broken=0;initial.material.broken=1;assert.throws(()=>assertWholeObjectAtRest({initial,unloaded}),/construction/);
const rest={material:{step:1,time:0,broken:0,hand:null,bodies:[pose(0),pose(1)],bonds:[{id:'b',a:0,b:1,alive:true}]}};
const distorted=structuredClone(rest);distorted.material.step=61;distorted.material.time=1;distorted.material.bodies[1].position.x=1000;
assert.throws(()=>assertWholeObjectAtRest({initial:rest,unloaded:distorted}),/displacement|shape|deform|motion/,'Intact connections cannot certify an object that has grossly changed shape');

const moving=structuredClone(rest);moving.material.step=61;moving.material.time=1;moving.material.bodies[1].velocity.x=100;assert.throws(()=>assertWholeObjectAtRest({initial:rest,unloaded:moving}),/continuing motion/);
const rotated=structuredClone(rest);rotated.material.step=61;rotated.material.time=1;rotated.material.bodies[1].quaternion={x:0,y:0,z:1,w:0};assert.throws(()=>assertWholeObjectAtRest({initial:rest,unloaded:rotated}),/rotation/);
const settled=structuredClone(rest);settled.material.step=61;settled.material.time=1;settled.material.bodies[1].position.x+=.001;assertWholeObjectAtRest({initial:rest,unloaded:settled});

let reads=0,turns=0;const idle=await waitForWholeObjectIdle(async()=>({busy:++reads<3,error:''}),async()=>{turns++;});assert.equal(idle.busy,false);assert.equal(reads,3);assert.equal(turns,2,'An asynchronous busy predicate must be retried, not accepted as a truthy promise');
await assert.rejects(waitForWholeObjectIdle(async()=>({busy:false,error:'reset failed'}),async()=>{}),/reset failed/);
const released=structuredClone(rest),free=structuredClone(rest);released.material.hand=null;free.material.hand=null;free.material.step++;free.material.time+=1/60;assertReleasedMaterialAdvances(released,free);free.material.step=released.material.step;assert.throws(()=>assertReleasedMaterialAdvances(released,free),/observed physical evolution/);
