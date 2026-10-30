// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {checkedMechanism,removeBranch} from '../experiments/link-workshop/model.mjs';
const frame={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const recipe={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,Math.PI/2]}],pistons:[],mounts:[{id:'tip',owner:{joint:1},position:[0,0,0],rotation:[0,0,0]},{id:'corner',owner:{objectId:'cube'},position:[1,0,0],rotation:[0,0,0]}],attachments:[{objectId:'cube',targetMount:'tip',sourceMount:'corner',offset:frame}],mountPistons:[{a:'tip',b:'corner'}]};
assert.doesNotThrow(()=>checkedMechanism(recipe),'Mount-to-mount fastening must be a persisted recipe');
const {mountMatrix,checkConnections}=await import('../experiments/link-workshop/mounts.mjs');
const {createAttachmentFollower}=await import('../experiments/link-workshop/attachments.mjs');
const scene=new T.Scene(),root=new T.Group(),cube=new T.Object3D();scene.add(root,cube);root.userData.linkMechanism=recipe;cube.scale.set(2,1,1);recipe.attachments[0].offset.scale=[2,1,1];
const entries=[{id:'mech',object:root},{id:'cube',object:cube}],follower=createAttachmentFollower(root,()=>entries);
const near=(a,b)=>assert.ok(a.every((x,i)=>Math.abs(x-b[i])<1e-7),`${a} != ${b}`);
follower.update(recipe,0);near(cube.position.toArray(),[0,0,0]);
follower.update(recipe,1);near(mountMatrix(root,recipe,'corner',1,entries).elements,mountMatrix(root,recipe,'tip',1,entries).elements);near(cube.scale.toArray(),[2,1,1]);
recipe.mounts[0].position=[.4,0,0];follower.update(recipe,1);near(mountMatrix(root,recipe,'corner',1,entries).elements,mountMatrix(root,recipe,'tip',1,entries).elements);
const removed=removeBranch(recipe,1);assert.equal(removed.attachments.length,0);assert.equal(removed.mountPistons.length,0);assert.equal(removed.mounts.length,1);
const invalid=structuredClone(recipe);invalid.mounts[0].owner={objectId:'cube'};assert.throws(()=>checkConnections(root,invalid,entries),/cycle|itself/i);
const invalid2=structuredClone(recipe);invalid2.mounts.push(structuredClone(invalid2.mounts[0]));assert.throws(()=>checkedMechanism(invalid2),/mount/i);
follower.dispose();console.log('Mount persistence, scaled source alignment, live frame editing, deletion and cycle rejection passed');

// Test the production controller: fastening moves a payload, and Undo must
// restore both its prior placement and the prior relationship, even pre-controller.
{
 const {createSceneEdits}=await import('../scene-edit-session.mjs');const {createMechanismController}=await import('../experiments/link-workshop.experiment.mjs');
 const scene=new T.Scene(),root=new T.Group(),payload=new T.Object3D();scene.add(root,payload);payload.position.set(5,3,0);root.userData.linkMechanism={...structuredClone(recipe),attachments:[],mountPistons:[]};
 const entries=[{id:'mech',object:root,type:'pbr'},{id:'cube',object:payload,type:'procedural-mesh'}],edits=createSceneEdits({read(){throw Error('ordinary pose not part of this test');},write(){}});
 const host={scene:{objects:()=>entries,async open(){return {async attach(root){return {id:'mech',root};},redraw(){},readView(){return {};},onFrame(){return ()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits}},components:{register(){return {changed(fn){fn?.();},dispose(){}};}}}};
 let runtime=await createMechanismController({host,inputs:{root}});const before=payload.position.toArray();runtime.operations.fasten({source:'corner',target:'tip'});assert.notDeepEqual(payload.position.toArray(),before);edits.undo();near(payload.position.toArray(),before);assert.equal(runtime.read().recipe.attachments.length,0);edits.redo();assert.equal(runtime.read().recipe.attachments.length,1);
 await runtime.dispose();edits.undo();near(payload.position.toArray(),before);assert.equal(root.userData.linkMechanism.attachments.length,0);edits.redo();runtime=await createMechanismController({host,inputs:{root}});assert.equal(runtime.read().recipe.attachments.length,1);edits.clear();await runtime.dispose();
}

// A mount on another mechanism's payload does not give this recipe's Undo custody of it.
{
 const {createSceneEdits}=await import('../scene-edit-session.mjs');const {createMechanismController}=await import('../experiments/link-workshop.experiment.mjs');
 const scene=new T.Scene(),a=new T.Group(),b=new T.Group(),payload=new T.Object3D();scene.add(a,b,payload);
 const base={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,Math.PI/2]}],pistons:[]};
 a.userData.linkMechanism={...structuredClone(base),attachments:[{objectId:'cube',joint:1,offset:structuredClone(frame)}]};
 b.userData.linkMechanism={...structuredClone(base),mounts:[{id:'foreign',owner:{objectId:'cube'},position:[0,0,0],rotation:[0,0,0]}]};
 const entries=[{id:'a',object:a,type:'pbr'},{id:'b',object:b,type:'pbr'},{id:'cube',object:payload,type:'procedural-mesh'}],edits=createSceneEdits({read(){throw Error('ordinary pose not part of this test');},write(){}});
 const host={scene:{objects:()=>entries,async open(){return {async attach(root){return {id:entries.find(e=>e.object===root).id,root};},redraw(){},readView(){return {};},onFrame(){return ()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits}},components:{register(){return {changed(fn){fn?.();},dispose(){}};}}}};
 const ra=await createMechanismController({host,inputs:{root:a}}),rb=await createMechanismController({host,inputs:{root:b}});
 rb.operations.period({seconds:4});ra.operations.seek({cycle:.5});const before=payload.position.toArray(),offset=structuredClone(ra.read().recipe.attachments[0].offset);
 edits.undo();ra.follow('cube');ra.tick();near(payload.position.toArray(),before);assert.deepEqual(ra.read().recipe.attachments[0].offset,offset);
 edits.redo();ra.follow('cube');near(payload.position.toArray(),before);assert.deepEqual(ra.read().recipe.attachments[0].offset,offset);edits.clear();await ra.dispose();await rb.dispose();
}
