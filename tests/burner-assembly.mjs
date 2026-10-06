import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneDocument, planSceneRestore, isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
import {BURNER_DEFAULTS} from '../annular-burner.mjs';
const pose={position:[1,-.8,2],rotation:[0,.3,0],scale:[1,1,1]};
const bed={id:'bed-one',type:'burner-bed',source:'kaminos:annular-bed',label:'Copper bed',transform:pose,burner:{...BURNER_DEFAULTS,outerRadius:.6}};
const group={id:'assembly-one',label:'Left burner',type:'burner-assembly',transform:pose,objectIds:[bed.id]};
test('procedural bed recipe and assembly frame survive the normal scene document',()=>{
 const doc=buildSceneDocument({objects:[bed],groups:[group],activeGroupId:group.id});
 const restored=planSceneRestore(doc);
 assert.deepEqual(restored.objects[0].burner,bed.burner,'bed recipe is authored state');
 assert.deepEqual(restored.groups[0].transform,pose,'assembly frame survives reopen');
 assert.equal(restored.groups[0].type,'burner-assembly');
 assert.equal(isReloadableSceneObjectRecord(restored.objects[0]),true);
});
test('invalid authored bed recipe cannot silently save or reopen',()=>{
 assert.throws(()=>buildSceneDocument({objects:[{...bed,burner:{...bed.burner,outerRadius:0}}]}),/radius/i);
});
test('nonuniform assembly scaling is rejected before child frames could shear',()=>{
 assert.throws(()=>buildSceneDocument({objects:[bed],groups:[{...group,transform:{...pose,scale:[1,2,1]}}]}),/uniform/i);
});
import {createAnnularBurner} from '../annular-burner.mjs';
import * as THREE from '../lib/three.core.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
test('an authored bed remains visible at its authored pose without a live ring',()=>{
 const bed=createAnnularBurner(THREE,mergeGeometries,{...BURNER_DEFAULTS,ringCount:2,sectorCount:3,subdivisions:6});
 bed.group.position.set(1,2,3);
 bed.update(null,false,0,[0,0,0],{authored:true});
 assert.equal(bed.group.visible,true,'a physical bed remains when its flame is absent');
 assert.deepEqual(bed.group.position.toArray(),[1,2,3]);
 bed.dispose();
});
import {moveAssemblyMembers,checkedAssemblyEdit} from '../burner-assembly.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
test('assembly preview carries children, cancellation restores exact poses and undo replays one gesture',()=>{
 let frame={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
 let members={bed:{...structuredClone(frame),position:[1,0,0]},flame:{...structuredClone(frame),position:[1,.1,0]}};
 const initial=structuredClone(members);
 const read=()=>({...structuredClone(frame),frame:structuredClone(frame),members:structuredClone(members)});
 const write=next=>{members=moveAssemblyMembers(next.frame,next,next.members);frame={position:next.position,rotation:next.rotation,scale:next.scale};};
 const edits=createSceneEdits({read:()=>null,write:()=>{throw Error('wrong target');}});
 edits.register('@assembly:one',{read,write,check:checkedAssemblyEdit});
 edits.begin('@assembly:one');edits.preview({rotation:[0,0,Math.PI/2]});
 assert.ok(Math.abs(members.bed.position[1]-1)<1e-12);assert.ok(Math.abs(members.flame.position[0]+.1)<1e-12);
 edits.cancel();assert.deepEqual(members,initial);assert.equal(edits.state().undoCount,0);
 edits.begin('@assembly:one');edits.preview({position:[2,0,0]});edits.commit();
 assert.deepEqual(members.flame.position,[3,.1,0]);assert.equal(edits.state().undoCount,1);
 edits.undo();assert.deepEqual(members,initial);edits.redo();assert.deepEqual(members.flame.position,[3,.1,0]);
});
test('an explicitly removed source remains absent in a new document, legacy compositions retain their source',()=>{
 const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
 const doc=buildSceneDocument({objects:[bed],composition});
 assert.equal(planSceneRestore(doc).flameSourcePresent,false);
 assert.equal(planSceneRestore({...doc,version:5}).flameSourcePresent,true);
});
