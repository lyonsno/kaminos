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

// The Outliner uses normalized records, after the common envelope clones fields.
// Their immutable mesh payloads must remain identifiable without vertex walks.
{
 const {exportHinge,importHinge}=await import('../experiments/link-workshop/hinge-primitives.mjs');
 const hardware=importHinge({family:'clevis',size:1},exportHinge({family:'clevis',size:1}));
 const input={...record,mechanism:{...recipe,mounts:[{id:'s',owner:{objectId:'payload'},position:[0,0,0],rotation:[0,0,0]},{id:'t',owner:{joint:1},position:[0,0,0],rotation:[0,0,0]}],attachments:[{objectId:'payload',sourceMount:'s',targetMount:'t',offset:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},hinge:[0,1],hardware}]}};
 const normalized=records.normalize(input),parts=normalized.mechanism.attachments[0].hardware.parts;
 const vertices=parts.moving.geometries.find(g=>g.data?.attributes?.position).data.attributes.position.array;
 assert.equal(records.reloadable(normalized),true);
 const stringify=JSON.stringify;let walks=0;
 JSON.stringify=function(value,replacer,space){return stringify(value,function(k,v){if(v===vertices)walks++;return typeof replacer==='function'?replacer.call(this,k,v):v;},space);};
 try{for(let i=0;i<4;i++)assert.equal(records.reloadable(normalized),true);}finally{JSON.stringify=stringify;}
 assert.equal(walks,0,'Normalized Outliner records must not traverse immutable hinge vertices on repeated reloadability checks');
 assert.ok(Object.isFrozen(vertices),'Normalized geometry must be immutable before identity-based admission caching');
 const detached=records.properties(normalized);detached.mechanism.attachments[0].hardware.parts.moving.object.name='changed externally';assert.notEqual(parts.moving.object.name,'changed externally','Public properties stay detached and mutable');
 normalized.mechanism.mounts[1].owner.joint=88;assert.equal(records.reloadable(normalized),false,'Normalized metadata mutations still invalidate admission');
 normalized.mechanism.mounts[1].owner.joint=1;
 const replaced=structuredClone(parts);replaced.moving.object.type='InvalidPart';
 assert.equal(records.reloadable(input),true);input.mechanism.attachments[0].hardware.parts=structuredClone(parts);assert.equal(records.reloadable(input),true);input.mechanism.attachments[0].hardware.parts.moving.object.type='InvalidPart';assert.equal(records.reloadable(input),false,'An external mutable part cannot reuse a previously retained valid copy');
 normalized.mechanism.attachments[0].hardware.parts=replaced;assert.equal(records.reloadable(normalized),false,'Replacing an immutable part with damaged mutable geometry must invalidate admission');
}

{
 const normalized=records.normalize(capturedWithBodies),vertices=normalized.geometry.bodies[0].object.geometries.find(g=>g.data?.attributes?.position).data.attributes.position.array;
 assert.equal(records.reloadable(normalized),true);const stringify=JSON.stringify;let walks=0;
 JSON.stringify=function(value,replacer,space){return stringify(value,function(k,v){if(v===vertices)walks++;return typeof replacer==='function'?replacer.call(this,k,v):v;},space);};
 try{assert.equal(records.reloadable(normalized),true);}finally{JSON.stringify=stringify;}
 assert.equal(walks,0,'Normalized returned body geometry also avoids repeated vertex walks');assert.ok(Object.isFrozen(vertices));
 const detached=records.properties(normalized);detached.geometry.bodies[0].object.object.name='external body';assert.notEqual(normalized.geometry.bodies[0].object.object.name,'external body');
}

// Live scene admission is a separate consumer from saved-document normalization.
{
 const {createSceneObjectRecord}=await import('../scene-object-record.mjs');
 const {createWorkingScene}=await import('../working-scene.mjs');
 const {exportHinge,importHinge}=await import('../experiments/link-workshop/hinge-primitives.mjs');
 const source=structuredClone(capturedWithBodies);source.mechanism.mounts=[{id:'s',owner:{objectId:'payload'},position:[0,0,0],rotation:[0,0,0]},{id:'t',owner:{joint:1},position:[0,0,0],rotation:[0,0,0]}];
 source.mechanism.attachments=[{objectId:'payload',sourceMount:'s',targetMount:'t',offset:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},hinge:[0,1],hardware:importHinge({family:'clevis',size:1},exportHinge({family:'clevis',size:1}))}];
 const object=mechanismObject(source.mechanism,source.geometry),live=createSceneObjectRecord(object,source,{id:'live'}),scene=createWorkingScene();scene.put(live);
 const entry=scene.objects[0],parts=entry.mechanism.attachments[0].hardware.parts,partVertices=parts.moving.geometries.find(g=>g.data?.attributes?.position).data.attributes.position.array,bodyVertices=entry.geometry.bodies[0].object.geometries.find(g=>g.data?.attributes?.position).data.attributes.position.array;
 assert.equal(records.reloadable(entry),true);const stringify=JSON.stringify;let partWalks=0,bodyWalks=0;
 JSON.stringify=function(value,replacer,space){return stringify(value,function(k,v){if(v===partVertices)partWalks++;if(v===bodyVertices)bodyWalks++;return typeof replacer==='function'?replacer.call(this,k,v):v;},space);};
 try{for(let i=0;i<4;i++)assert.equal(records.reloadable(entry),true);}finally{JSON.stringify=stringify;}
 assert.equal(partWalks,0,'Live Outliner entries retain hinge identities after scene admission');assert.equal(bodyWalks,0,'Live Outliner entries retain returned body identities after scene admission');
 assert.ok(Object.isFrozen(partVertices));assert.ok(Object.isFrozen(bodyVertices));
 const oldName=parts.moving.object.name;source.mechanism.attachments[0].hardware.parts=structuredClone(parts);source.mechanism.attachments[0].hardware.parts.moving.object.name='caller';assert.equal(parts.moving.object.name,oldName,'Live retained fields must not alias mutable input');
 const publicFields=records.properties(entry);publicFields.mechanism.attachments[0].hardware.parts.moving.object.name='public';assert.equal(parts.moving.object.name,oldName,'Live record property extraction remains detached');
 entry.mechanism.mounts[1].owner.joint=88;assert.equal(records.reloadable(entry),false,'Live metadata invalidation is preserved');
}
