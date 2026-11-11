// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {defaultSpace,checkedSpace,concreteDistance,spaceDirection,pullSpace,transformSpaceClaim,createSpace,rebuildSpace,spaceBounds,SPACE_SOURCE,closestSpaceClaim} from '../stockroom-space.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {createSceneRepetitionController} from '../scene-repetition-controller.mjs';
import {repetitionDefaults,isRepetitionCopy} from '../scene-repetition.mjs';
test('an authored empty region has real concrete around it, not in it',()=>{
 const p=defaultSpace();
 assert.ok(concreteDistance(p,[0,1.05,0])>0,'passage must remain empty');
 assert.ok(concreteDistance(p,[1.43,1.05,0])<0,'its shoulder must have material');
 assert.ok(concreteDistance(p,[0,2.05,0])<0,'the claim must carry a curved upper boundary');
});
test('local direction follows the chosen boundary before committing',()=>{
 assert.deepEqual(spaceDirection(defaultSpace(),{claim:'passage',point:[1.25,1.05,0]}),[1,0,0]);
 assert.deepEqual(spaceDirection(defaultSpace(),{claim:'passage',point:[0,1.9,0]}),[0,1,0]);
});
test('a drag is relative to its starting state, can reverse exactly and does not mutate it',()=>{
 const p=defaultSpace(),before=structuredClone(p),probe={claim:'passage',point:[0,1.9,0],axis:[0,1,0]};
 const a=pullSpace(p,probe,.6,'empty');
 assert.ok(a.claims[0].radii[1]>p.claims[0].radii[1]);
 assert.deepEqual(p,before);assert.deepEqual(pullSpace(p,probe,0,'empty'),p);
 assert.deepEqual(pullSpace(p,probe,.6,'empty'),a);
 assert.ok(Math.abs((a.claims[0].center[1]-a.claims[0].radii[1])-(p.claims[0].center[1]-p.claims[0].radii[1]))<1e-12);
});
test('a new surface pull creates retained material and a later cut creates a new empty subject',()=>{
 const p=defaultSpace(),probe={point:[1.43,1.05,0],axis:[1,0,0],id:'ledge'};
 const a=pullSpace(p,probe,.9,'occupy');
 assert.equal(a.claims.length,2);assert.ok(concreteDistance(a,[1.9,1.05,0])<0);
 const b=pullSpace(a,{point:[1.9,1.05,.3],axis:[0,0,-1],id:'new-pocket'},.65,'empty');
 assert.equal(b.claims.length,3);assert.equal(b.claims[2].id,'new-pocket');
 assert.ok(concreteDistance(b,[1.9,1.05,0])>0);
 const c=pullSpace(b,{claim:'new-pocket',point:[1.9,1.4,0],axis:[0,1,0]},.2,'empty');
 assert.notDeepEqual(c.claims[2],b.claims[2]);
});
test('unsupported recipes fail loudly before changing geometry',()=>{
 for(const patch of [{resolution:1},{claims:[{id:'bad',role:'empty',center:[NaN,0,0],radii:[1,1,1]}]},{claims:[{id:'bad'}]}])assert.throws(()=>checkedSpace({...defaultSpace(),...patch}));
});
test('native region transforms move its authored claim without changing its siblings',()=>{
 const space=defaultSpace(),c=space.claims[0],anchor={position:c.center,rotation:c.rotation,scale:c.radii};
 const next=transformSpaceClaim({space,claim:c.id,anchor,...anchor,position:[.4,1.05,0]},new THREE.Matrix4());
 next.claims[0].center.forEach((v,i)=>assert.ok(Math.abs(v-[.4,1.05,0][i])<1e-12));next.claims[0].radii.forEach((v,i)=>assert.ok(Math.abs(v-c.radii[i])<1e-12));
});
test('native region rotation and scale carry the surrounding boundary plane',()=>{
 const space=defaultSpace(),c=space.claims[0],anchor={position:c.center,rotation:c.rotation,scale:c.radii};
 const next=transformSpaceClaim({space,claim:c.id,anchor,...anchor,rotation:[0,Math.PI/2,0],scale:c.radii.map(x=>x*2)},new THREE.Matrix4()).claims[0];
 assert.ok(Math.abs(next.bandNormal[0]-1)<1e-12);assert.ok(Math.abs(next.bandNormal[2])<1e-12);assert.ok(Math.abs(next.bandHalfWidth-.88)<1e-12);
});
test('kept empty remains empty even when a material claim covers the opening',()=>{
 const p=defaultSpace(),grown=pullSpace(p,{point:[0,1.05,0],axis:[1,0,0]},1,'occupy');
 assert.ok(concreteDistance(grown,[0,1.05,0])>0);
});
test('actual extraction changes rendered triangles, keeps full capacity and follows bounds',()=>{
 const p={...defaultSpace(),resolution:20},root=createSpace(p),mesh=root.children[0],before=mesh.geometry.attributes.position.array.slice(0,mesh.count*3);
 assert.ok(mesh.count>0);assert.equal(mesh.geometry.drawRange.count,mesh.count);assert.ok(mesh.count<=5*(p.resolution-3)**3*3);
 assert.equal(mesh.geometry.attributes.position.count,mesh.count,'native geometry must expose drawn vertices, not the extractor capacity');
 assert.ok([...before].every(Number.isFinite));assert.ok([...mesh.geometry.attributes.normal.array.slice(0,mesh.count*3)].every(Number.isFinite));
 rebuildSpace(root,pullSpace(p,{claim:'passage',point:[0,1.9,0],axis:[0,1,0]},.5,'empty'));
 assert.equal(root.children[0],mesh);assert.notDeepEqual(mesh.geometry.attributes.position.array.slice(0,mesh.count*3),before);
 const extended=pullSpace(p,{point:[8,1,0],axis:[1,0,0]},1,'occupy');assert.ok(spaceBounds(extended).max.x>9);
});
test('native preview, rejected collapse, cancel, Undo and Redo retain a single recipe',()=>{
 const p={...defaultSpace(),resolution:16},root=createSpace(p),edits=createSceneEdits({read(){},write(){}});
 edits.register('@space:test',{read:()=>root.userData.stockroomSpace,check:checkedSpace,write:value=>rebuildSpace(root,value)});
 const probe={claim:'passage',point:[0,1.9,0],axis:[0,1,0]};edits.begin('@space:test');edits.preview(pullSpace(p,probe,.5,'empty'));
 assert.throws(()=>edits.preview({...p,claims:[{...p.claims[0],radii:[1,0,1]}]}));assert.equal(root.userData.stockroomSpace.claims[0].radii[1],1.1);
 edits.cancel();assert.deepEqual(root.userData.stockroomSpace,p);edits.apply('@space:test',pullSpace(p,probe,.4,'empty'));assert.equal(edits.state().undoCount,1);
 edits.undo();assert.deepEqual(root.userData.stockroomSpace,p);edits.redo();assert.ok(root.userData.stockroomSpace.claims[0].radii[1]>p.claims[0].radii[1]);
});
test('ordinary scene record and document reload recreate source, claims and placement',async()=>{
 const p={...defaultSpace(),resolution:16},root=createSpace(p);root.position.set(3,.2,-1);root.rotation.y=.4;
 const row=createSceneObjectRecord(root,{type:'pbr'},{id:'place'}),records=createSceneRecordOperations({readers:{transform:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),materials:()=>null},loaders:{constructed:(object,record)=>{object.position.fromArray(record.transform.position);object.rotation.set(...record.transform.rotation);return object;}}});
 const saved=records.serialize(row),document=buildSceneDocument({objects:[saved]}),record=planSceneRestore(JSON.parse(JSON.stringify(document))).objects[0];
 assert.equal(record.source,SPACE_SOURCE);assert.deepEqual(record.space,p);assert.equal(records.reloadable(record),true);
 const restored=await records.load(record);assert.deepEqual(restored.position.toArray(),root.position.toArray());assert.equal(restored.children[0].count,root.children[0].count);assert.deepEqual(restored.userData.stockroomSpace,p);
 assert.equal(records.reloadable({...record,space:{...p,resolution:2}}),false);
});
test('shrinking a surface keeps framing bounds equal to actual rendered vertices',()=>{
 const p={...defaultSpace(),resolution:20},root=createSpace(p),probe={claim:'passage',point:[0,1.9,0],axis:[0,1,0]};
 rebuildSpace(root,pullSpace(p,probe,1.8,'empty'));rebuildSpace(root,pullSpace(p,probe,-.6,'empty'));
 const mesh=root.children[0],active=new THREE.Box3(),position=mesh.geometry.attributes.position;root.updateMatrixWorld(true);
 for(let i=0;i<mesh.geometry.drawRange.count;i++)active.expandByPoint(new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld));
 const all=new THREE.Box3().setFromObject(root);for(const key of ['min','max'])for(const axis of ['x','y','z'])assert.ok(Math.abs(active[key][axis]-all[key][axis])<1e-6,`${key}.${axis} contains an unwritten/stale extractor vertex`);
});
test('native repeated space copies refresh their child frames after shape changes',()=>{
 const p={...defaultSpace(),resolution:16},root=createSpace(p),entry={id:'place',object:root,type:'pbr',source:SPACE_SOURCE,space:p,repetition:{...repetitionDefaults(),mode:'line',count:2,step:[6,0,0]}};
 const controller=createSceneRepetitionController({objects:()=>[entry],groups:()=>[],readPose:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()})});controller.sync();
 const next=pullSpace(p,{claim:'passage',point:[0,1.9,0],axis:[0,1,0]},.8,'empty');rebuildSpace(root,next);entry.space=next;controller.sync();
 const original=root.children.find(c=>c.userData.spaceSurface),copy=root.children.find(isRepetitionCopy).children[0];assert.deepEqual(copy.position.toArray(),original.position.toArray());assert.deepEqual(copy.scale.toArray(),original.scale.toArray());assert.equal(copy.geometry,original.geometry);controller.clearAll();
});
test('region picking uses each claim rotation rather than an axis-aligned proxy',()=>{
 const p=defaultSpace(),base=p.claims[0];p.claims=[{...base,id:'decoy',role:'occupy',rim:false,center:[3.2,1.5,0],radii:[.2,.2,.2]},{...base,id:'rotated',role:'occupy',rim:false,center:[2,1,0],radii:[.3,1.2,.3],rotation:[0,0,Math.PI/2]}];
 assert.equal(closestSpaceClaim(p,[3.2,1,0]),'rotated');
});
