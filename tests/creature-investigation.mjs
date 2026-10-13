// kaminos-test: node
import assert from 'node:assert/strict';
import * as contribution from '../experiments/creature-motion/retained.experiment.mjs';
import {investigationOperations} from '../investigation-recording.mjs';
assert.equal(typeof contribution.installCreatureInvestigation,'function','Creature contribution lacks its common-recording/UI adapter');
const {installCreatureInvestigation}=contribution;
class Element {constructor(){this.style={};this.children=[];this.isConnected=true;}append(...nodes){this.children.push(...nodes);}setAttribute(){} }
const document={createElement:()=>new Element()};
let state={status:'paused',frame:30,time:1,rootUuid:'body-one',clipName:'trot',source:{source_sha256:'a'.repeat(64),frames:60,fps:30,retargeted:false},asset:{id:'one',requested:'/body.glb'},view:{position:[1,2,3],target:[0,0,0]}};
const entry={state:()=>({id:'marionette/retained-creature',moduleUrl:'/experiments/creature-motion/retained.experiment.mjs'}),read:async()=>structuredClone(state)};
const registry=new Map(),root=new Element(),requests=[];
const source={route:'actual-adapter/local-policy-fixture',rawMotionSha256:'a'.repeat(64)};
const adapter=await installCreatureInvestigation({id:'recording-one',source,entry,document,mountRoot:root,
 registry,request:async value=>(requests.push(value),{message:'retained'}),readScene:()=>({objects:[{id:'unrelated'},{id:'one',source:'/body.glb'}]}),viewport:()=>({width:800,height:600})});
try {
 let observed=await adapter.read();
 assert.equal(observed.recording.complete,true);assert.equal(observed.context.recipe.inputs.frame,30);
 assert.equal(observed.context.recipe.inputs.source_sha256,state.source.source_sha256);
 assert.deepEqual(observed.context.recipe.inputs.view,state.view);
 assert.equal(observed.context.scene.objects[0].id,'unrelated');
 investigationOperations.emit({kind:'creature.seek',phase:'applied',target:'one',effective:{frame:30}});
 observed=await adapter.read();assert.equal(observed.recording.operations.length,1);
 const buttons=[];const walk=node=>{if(node.textContent==='Capture'||node.textContent==='Finish')buttons.push(node);for(const child of node.children??[])walk(child);};walk(root);
 assert.equal(buttons.length,2);await buttons.find(node=>node.textContent==='Capture').onclick();
 assert.equal(requests[0].action,'capture');
 assert.equal(await adapter.isPresent(),true);
 state={...state,rootUuid:'replacement'};
 assert.equal(await adapter.isPresent(),false);
 await assert.rejects(adapter.read(),/changed/);
 const finished=await adapter.finish();assert.equal(finished.recording.status,'finished');
 assert.match(finished.context.unavailable,/changed/);assert.equal(finished.context.lastObserved.recipe.inputs.frame,30);
 assert.equal(finished.recording.operations.length,1,'finish preserves the full prefix after replacement');
} finally {await adapter.disconnect('test complete');}
await assert.rejects(installCreatureInvestigation({id:'wrong-source',source:{...source,rawMotionSha256:'b'.repeat(64)},entry,document,mountRoot:root,registry:new Map(),request:async()=>{},readScene:()=>({})}),/source/);
await assert.rejects(installCreatureInvestigation({id:'missing-registration',source,entry,document,mountRoot:root,registry:new Map(),request:async()=>{},readScene:()=>({objects:[{id:'unrelated'}]}),viewport:()=>({width:800,height:600})}),/registered/);
console.log('Creature guide/recorder retains source-frame recipe and full prefix, exposes replacement honestly and preserves unrelated scene context');
