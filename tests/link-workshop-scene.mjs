// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {emptyMechanism,appendJoint} from '../experiments/link-workshop/model.mjs';
const recipe=appendJoint(appendJoint(emptyMechanism(),null,[0,0]),0,[2,0]);
const records=createSceneRecordOperations();
const record={id:'mechanism',type:'pbr',source:'kaminos:link-mechanism',mechanism:recipe};
assert.equal(records.reloadable(record),true,'A mechanism must reconstruct through ordinary scene records');
assert.deepEqual(records.normalize(record).mechanism,recipe);
const bad=structuredClone(record);bad.mechanism.attachments=[{objectId:'payload',joint:88,offset:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}];
assert.equal(records.reloadable(bad),false,'Unknown attachment joints must refuse scene admission');
console.log('Mechanism scene domain passed');
const {createAttachmentFollower,attachmentFrame}=await import('../experiments/link-workshop/attachments.mjs');
const {mechanismObject}=await import('../experiments/link-workshop/record.mjs');
const {removeBranch}=await import('../experiments/link-workshop/model.mjs');
const scene=new T.Scene(),root=mechanismObject(recipe),payload=new T.Object3D();scene.add(root,payload);root.position.set(3,1,2);root.rotation.z=.3;payload.position.set(5,4,2);scene.updateMatrixWorld(true);
recipe.nodes[1].angles=[0,Math.PI/2];recipe.attachments=[{objectId:'payload',joint:1,offset:attachmentFrame(root,recipe,1,0,payload)}];
const original=payload.matrixWorld.clone(),offset=structuredClone(recipe.attachments[0].offset),follow=createAttachmentFollower(root,()=>[{id:'payload',object:payload}]);
follow.update(recipe,0);assert.ok(payload.matrixWorld.elements.every((x,i)=>Math.abs(x-original.elements[i])<1e-10),'Attaching preserves world placement');
follow.update(recipe,1);assert.notDeepEqual(payload.position.toArray(),[5,4,2]);assert.deepEqual(recipe.attachments[0].offset,offset,'Motion retains attachment frame');
root.position.x+=4;follow.update(recipe,1);assert.deepEqual(recipe.attachments[0].offset,offset,'Assembly translation retains attachment frame');
payload.position.z+=1;follow.update(recipe,1);assert.notDeepEqual(recipe.attachments[0].offset,offset,'Native payload edit adjusts attachment');
root.userData.linkMechanism=recipe;
const captured=createSceneRecordOperations({readers:{transform:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),materials:()=>null}}).serialize({id:'mechanism',type:'pbr',source:'kaminos:link-mechanism',object:root});
assert.deepEqual(captured.mechanism,recipe);
let restored;
await createSceneRecordOperations({loaders:{constructed:o=>{restored=o;return o;}}}).load(captured);
assert.deepEqual(restored.userData.linkMechanism,recipe);
assert.equal(removeBranch(recipe,1).attachments.length,0,'Removing a branch releases its payload binding');
// Returned body geometry persists on ordinary scene records and remaps across branch deletion.
const {exportBodyGeometry,remapBodyGeometry}=await import('../experiments/link-workshop/bodies.mjs');
const branched=appendJoint(appendJoint(appendJoint(emptyMechanism(),null,[0,0]),0,[2,0]),0,[0,2]);
const packet=exportBodyGeometry(branched);
const link2=packet.bodies.find(b=>b.id==='link:2');link2.object.materials[0].color=0x22cc88;
root.userData.linkMechanism=branched;
root.userData.linkGeometry={schema:'kaminos.assembly-geometry.v1',key:packet.key,bodies:[link2]};
const capturedWithBodies=createSceneRecordOperations({readers:{transform:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),materials:()=>null}}).serialize({id:'mechanism',type:'pbr',source:'kaminos:link-mechanism',object:root});
assert.equal(capturedWithBodies.geometry?.bodies?.[0]?.id,'link:2','Scene record serializes returned body geometry');
await createSceneRecordOperations({loaders:{constructed:o=>{restored=o;return o;}}}).load(capturedWithBodies);
assert.equal(restored.userData.linkGeometry?.bodies?.[0]?.id,'link:2','Scene record restores returned body geometry onto root.userData.linkGeometry');
const afterBranch=removeBranch(branched,1),remapped=remapBodyGeometry(branched,afterBranch,restored.userData.linkGeometry,{removedNode:1});
assert.deepEqual(remapped.bodies.map(b=>b.id),['link:1'],'Surviving branch body IDs remap when an earlier branch is deleted');
console.log('Attachment placement, native offset editing, moving assembly, body-geometry scene records, and branch-deletion remapping passed');

// The live outliner asks the exact same reloadability question on every joint
// selection. It must not parse/dispose every returned mesh again on a cache hit.
{
 const display=structuredClone(capturedWithBodies),body=display.geometry.bodies[0];
 const group=new T.Group();group.add(new T.Mesh(new T.BoxGeometry(1,1,1).toNonIndexed(),new T.MeshBasicMaterial()));body.object=group.toJSON();
 assert.equal(records.reloadable(display),true);const parse=T.ObjectLoader.prototype.parse;let parses=0;T.ObjectLoader.prototype.parse=function(...args){parses++;return parse.apply(this,args);};
 try{
  for(let i=0;i<4;i++)assert.equal(records.reloadable(display),true);
  assert.equal(parses,0,'Repeated outliner checks must reuse exact-content geometry validation');
  const positions=body.object.geometries[0].data.attributes.position.array,before=positions[0];positions[0]=NaN;
  assert.equal(records.reloadable(display),false,'In-place vertex damage must invalidate the display validation');
  positions[0]=before;display.mechanism.nodes[2].length+=.1;assert.equal(records.reloadable(display),false,'Recipe changes must invalidate geometry compatibility');
  display.mechanism.nodes[2].length-=.1;assert.equal(records.reloadable(display),true,'Corrected content can be validated again');
 }finally{T.ObjectLoader.prototype.parse=parse;}
}

// Removing the last returned shell must clear stale scene-registration metadata.
{
 const old=structuredClone(capturedWithBodies),object=mechanismObject(branched,old.geometry);object.userData.kaminosSceneObject=old;delete object.userData.linkGeometry;
 const serializer=createSceneRecordOperations({readers:{transform:()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}),materials:()=>null}}),saved=serializer.serialize({...old,object});
 assert.equal(saved.geometry,undefined,'An absent live shell must override the original scene record');assert.equal(serializer.reloadable(saved),true);
}
