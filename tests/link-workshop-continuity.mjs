// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {sceneObjectPoseHistory} from '../scene-object-pose-history.mjs';
import {attachmentFrame,createAttachmentFollower} from '../experiments/link-workshop/attachments.mjs';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
const recipe=()=>({schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,Math.PI/2]}],pistons:[]});
const pose=o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()});
const near=(a,b)=>assert.ok(a.every((x,i)=>Math.abs(x-b[i])<1e-8),`${a} != ${b}`);
if(!process.env.CASE || process.env.CASE==='offset'){
 const scene=new T.Scene(),root=new T.Group(),object=new T.Object3D(),model=recipe();scene.add(root,object);object.position.set(2,0,0);
 model.attachments=[{objectId:'payload',joint:1,offset:attachmentFrame(root,model,1,0,object)}];const follower=createAttachmentFollower(root,()=>[{id:'payload',object}]);follower.update(model,0);
 const edits=createSceneEdits({read:()=>pose(object),write:(_,p)=>{object.position.fromArray(p.position);object.rotation.set(...p.rotation);object.scale.fromArray(p.scale);},history:()=>sceneObjectPoseHistory(object)});
 edits.apply('payload',{...pose(object),position:[2,0,1]});follower.update(model,0);follower.update(model,1);edits.undo();follower.update(model,1);near(object.position.toArray(),[0,2,0]);near(model.attachments[0].offset.position,[0,0,0]);edits.redo();follower.update(model,1);near(object.position.toArray(),[0,2,1]);
 follower.dispose?.();
}
if(!process.env.CASE || process.env.CASE==='scale'){
 const scene=new T.Scene(),root=new T.Group(),object=new T.Object3D(),model=recipe();scene.add(root,object);root.scale.set(2,1,1);model.nodes[1].angles=[Math.PI/4,Math.PI/2];object.position.set(3,2,0);object.rotation.z=.4;scene.updateMatrixWorld(true);const before=object.matrixWorld.clone();
 model.attachments=[{objectId:'payload',joint:1,offset:attachmentFrame(root,model,1,0,object)}];const follower=createAttachmentFollower(root,()=>[{id:'payload',object}]);follower.update(model,0);near(object.matrixWorld.elements,before.elements);follower.update(model,1);near(object.scale.toArray(),[1,1,1]);follower.dispose?.();
}
if(!process.env.CASE || process.env.CASE==='history'){
 const scene=new T.Scene(),entries=[];const edits=createSceneEdits({read(){throw Error('Missing ordinary object');},write(){throw Error('Missing ordinary object');}});
 const host={scene:{objects:()=>entries,async open(){return {async attach(root){return {id:'mechanism',root};},redraw(){},readView(){return {};},onFrame(){return ()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits}},components:{register(){return {changed(fn){fn?.();},dispose(){}};}}}};
 let root=new T.Group();root.userData.linkMechanism={schema:'kaminos.links.v1',period:3,nodes:[],pistons:[]};scene.add(root);entries.push({id:'mechanism',object:root});
 let runtime=await createMechanismController({host,inputs:{root}});runtime.operations.append({parent:null,point:[0,0]});runtime.operations.append({parent:0,point:[2,0]});const saved=runtime.read().recipe,count=edits.state().undoCount;
 entries.length=0;root.removeFromParent();await runtime.dispose();assert.equal(edits.state().undoCount,count,'Temporary absence must not discard construction history');
 root=new T.Group();root.userData.linkMechanism=saved;scene.add(root);entries.push({id:'mechanism',object:root});
 // History can run before the frame service has recreated controls.
 edits.undo();assert.equal(root.userData.linkMechanism.nodes.length,1);edits.redo();assert.equal(root.userData.linkMechanism.nodes.length,2);
 runtime=await createMechanismController({host,inputs:{root}});edits.undo();assert.equal(runtime.read().recipe.nodes.length,1);edits.redo();assert.equal(runtime.read().recipe.nodes.length,2);edits.clear();await runtime.dispose();
}
console.log('Attachment-relative history, scaled rigid frames, and reconstructed mechanism history passed');
