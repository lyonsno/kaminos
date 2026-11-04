// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createCarriageRun} from '../casting-carriage.mjs';
test('one-way carrier reaches the delivery pose once and holds there',()=>{
 let value=0,arrivals=0;const run=createCarriageRun({write:v=>value=v,arrive:()=>arrivals++});
 run.start(0,.5,4);run.advance(1);assert.equal(value,.125);run.advance(8);assert.equal(value,.5);assert.equal(arrivals,1);
 run.advance(5);assert.equal(value,.5);assert.equal(arrivals,1);
 run.start(.5,0,4);run.advance(2);assert.equal(value,.25);run.cancel();run.advance(10);assert.equal(value,.25);
});
test('invalid runs and elapsed time preserve the current motion',()=>{
 const run=createCarriageRun({write(){}});run.start(0,.5,4);const state=run.read();
 for(const args of [[NaN,.5,4],[0,1,4],[0,.5,0]])assert.throws(()=>run.start(...args));
 assert.throws(()=>run.advance(-1));assert.deepEqual(run.read(),state);
});

test('saved mechanism captures and reloads the delivery pose for attached payloads',async()=>{
 const {mechanismObject,mechanismRecordDomain}=await import('../experiments/link-workshop/record.mjs');
 const recipe={schema:'kaminos.links.v1',period:4,nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,1]}],pistons:[]};
 const root=mechanismObject(recipe);root.userData.mechanismFraction=.73;
 const captured=mechanismRecordDomain.capture({object:root});
 assert.equal(captured.mechanismPosition,.73);
 const checked=mechanismRecordDomain.check(captured);let restored;
 mechanismRecordDomain.load(checked,{constructed:o=>restored=o});
 assert.equal(restored.userData.mechanismFraction,.73);
 assert.throws(()=>mechanismRecordDomain.check({...captured,mechanismPosition:2}));
});

test('native mechanism carries, holds, detaches and restores an attached casting at its saved pose',async()=>{
 const T=await import('../lib/three.core.js');
 const {createSceneEdits}=await import('../scene-edit-session.mjs');
 const {createMechanismController}=await import('../experiments/link-workshop.experiment.mjs');
 const {mechanismObject,mechanismRecordDomain}=await import('../experiments/link-workshop/record.mjs');
 const scene=new T.Scene(),entries=[],edits=createSceneEdits({read(){throw Error('ordinary target missing');},write(){throw Error('ordinary target missing');}});
 const host={scene:{objects:()=>entries,async open(){return {async attach(root){return {id:'loader',root};},redraw(){},readView(){return {};},onFrame(){return()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits}},components:{register(){return {changed(fn){fn?.();},dispose(){}};}}}};
 const recipe={schema:'kaminos.links.v1',period:4,nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,Math.PI/2]}],pistons:[]};
 let root=mechanismObject(recipe);const casting=new T.Object3D();casting.position.set(2,0,0);scene.add(root,casting);entries.push({id:'loader',object:root,type:'pbr'},{id:'casting',object:casting,type:'pbr'});
 let runtime=await createMechanismController({host,inputs:{root}});
 runtime.operations.attach({objectId:'casting',joint:1});
 const run=createCarriageRun({write:cycle=>runtime.operations.seek({cycle})});run.start(0,.5,4);run.advance(2);
 assert.ok(casting.position.distanceTo(new T.Vector3(Math.sqrt(2),Math.sqrt(2),0))<1e-8,'payload follows the actual native joint frame');
 run.advance(2);assert.ok(casting.position.distanceTo(new T.Vector3(0,2,0))<1e-8);
 const record=mechanismRecordDomain.check(mechanismRecordDomain.capture({object:root}));
 await runtime.dispose();root.removeFromParent();mechanismRecordDomain.load(record,{constructed:o=>root=o});scene.add(root);entries[0].object=root;
 runtime=await createMechanismController({host,inputs:{root}});
 assert.ok(casting.position.distanceTo(new T.Vector3(0,2,0))<1e-8,'reopening must not drag payload back to A');
 runtime.operations.detach({objectId:'casting'});run.start(.5,0,4);run.advance(4);
 assert.ok(casting.position.distanceTo(new T.Vector3(0,2,0))<1e-8,'return leaves detached casting in place');
 assert.ok(runtime.read().points[1].every((v,i)=>Math.abs(v-[2,0][i])<1e-8));
 await runtime.dispose();edits.clear();
});

test('removing or reindexing loader branches preserves a valid delivery joint',async()=>{
 const {checkedMechanism,removeBranch}=await import('../experiments/link-workshop/model.mjs');
 const m={schema:'kaminos.links.v1',period:4,nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[0,1]},{parent:null,point:[2,0]},{parent:2,length:1,angles:[0,1]}],pistons:[],castingCarrier:{moldId:'mold',joint:3}};
 assert.equal(removeBranch(m,1).castingCarrier.joint,2);
 assert.equal(removeBranch(m,2).castingCarrier,undefined);
 assert.throws(()=>checkedMechanism({...m,castingCarrier:{moldId:'mold',joint:99}}),/carrier/i);
});
