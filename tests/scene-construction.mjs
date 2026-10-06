import test from 'node:test';
import assert from 'node:assert/strict';
import {getSceneObjectRecords,getSceneGroupRecords,buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {BURNER_DEFAULTS} from '../annular-burner.mjs';
const pose={position:[1,2,3],rotation:[0,0,0],scale:[1,1,1]};
test('legacy burner geometry becomes ordinary procedural mesh data without losing its recipe',()=>{
 const [record]=getSceneObjectRecords({version:6,objects:[{id:'old-bed',type:'burner-bed',source:'kaminos:annular-bed',burner:BURNER_DEFAULTS,transform:pose}]});
 assert.equal(record.type,'procedural-mesh');assert.equal(record.geometry.kind,'annular');assert.equal(record.geometry.parameters.outerRadius,BURNER_DEFAULTS.outerRadius);assert.equal(record.geometry.parameters.bedColor,undefined);assert.equal(record.surface.bedColor,BURNER_DEFAULTS.bedColor);
 assert.equal('burner' in record,false,'the geometry recipe has one canonical owner');
});
test('an ordinary group frame survives scene save just as the legacy assembly frame does',()=>{
 const objects=[{id:'mesh',type:'glb',source:'/api/read?root=generated-meshes&path=a.glb',transform:pose}];
 const doc=buildSceneDocument({objects,groups:[{id:'g',label:'Things',objectIds:['mesh'],transform:pose}]});
 assert.deepEqual(planSceneRestore(doc).groups[0].transform,pose);assert.equal(doc.groups[0].type,'group');
 const old=getSceneGroupRecords({groups:[{id:'g',type:'burner-assembly',objectIds:['mesh'],transform:pose}]},objects)[0];
 assert.equal(old.type,'group');assert.deepEqual(old.transform,pose);
});
test('procedural geometry is preserved in the same saved object list as imported meshes',()=>{
 const geometry={kind:'box',parameters:{width:1,height:2,depth:3}};
 const doc=buildSceneDocument({objects:[{id:'cube',type:'procedural-mesh',source:'kaminos:geometry',geometry,transform:pose}]});
 assert.deepEqual(planSceneRestore(doc).objects[0].geometry,geometry);
});
import {isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
test('an authored spot light owns its data in the ordinary object record',()=>{
 const light={kind:'spot',enabled:true,color:'#ffffff',intensity:2,target:[0,0,0],azimuth:0,elevation:30,distance:3,angle:20,penumbra:.3};
 const record={id:'@rim-light',type:'light',source:'kaminos:scene-spot-light',light,transform:pose};
 const restored=planSceneRestore(buildSceneDocument({objects:[record]})).objects[0];
 assert.equal(restored.light.intensity,light.intensity);assert.equal(restored.light.aimDistance,light.distance);assert.equal(restored.light.target,undefined);assert.equal(restored.light.azimuth,undefined);assert.deepEqual(restored.transform,pose);assert.equal(isReloadableSceneObjectRecord(restored),true);
});
import {moveGroupMembers,identityGroupPose} from '../scene-group.mjs';
import {checkedGeometry,checkedProceduralMesh} from '../scene-geometry.mjs';
test('ordinary groups transform imported and generated members in the same frame',()=>{
 const before=identityGroupPose(),members={imported:{...before,position:[1,0,0]},generated:{...before,position:[0,2,0]}};
 const after={...before,position:[3,0,0],rotation:[0,0,Math.PI/2]};const moved=moveGroupMembers(before,after,members);
 assert.ok(Math.abs(moved.imported.position[0]-3)<1e-10);assert.ok(Math.abs(moved.imported.position[1]-1)<1e-10);
 assert.ok(Math.abs(moved.generated.position[0]-1)<1e-10);assert.deepEqual(members.imported.position,[1,0,0]);
 const restored=moveGroupMembers(after,before,moved);for(const id of Object.keys(members))assert.ok(restored[id].position.every((v,i)=>Math.abs(v-members[id].position[i])<1e-10));
});
test('group scaling supports representable transforms and refuses shear without mutating inputs',()=>{
 const before=identityGroupPose(),member={...before,position:[1,2,3]};
 const moved=moveGroupMembers(before,{...before,scale:[2,3,4]},{mesh:member});assert.deepEqual(moved.mesh.position,[2,6,12]);assert.deepEqual(moved.mesh.scale,[2,3,4]);
 const rotated={...member,rotation:[0,0,Math.PI/4]};assert.throws(()=>moveGroupMembers(before,{...before,scale:[2,3,4]},{mesh:rotated}),/shear/);assert.deepEqual(rotated.position,[1,2,3]);
});
test('legacy scene light is migrated into ordinary data and source absence stays absent',()=>{
 const light={enabled:true,color:'#ffffff',intensity:2,target:[0,0,0],azimuth:0,elevation:30,distance:3,angle:20,penumbra:.3};
 const records=getSceneObjectRecords({version:6,objects:[],environment:{rimLight:light}});assert.equal(records[0].type,'light');assert.equal(records[0].light.role,'rim');
 assert.equal(getSceneObjectRecords({version:7,objects:[],environment:{rimLight:light}}).length,0);
});
test('geometry parameters and material response have separate canonical owners',()=>{
 const r=checkedProceduralMesh({id:'p',type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'annular',parameters:BURNER_DEFAULTS},transform:pose});
 assert.equal(r.surface.fieldBinding,null);assert.equal(r.geometry.parameters.glow,undefined);assert.equal(r.surface.glow,BURNER_DEFAULTS.glow);
 assert.throws(()=>checkedGeometry({kind:'sphere',parameters:{radius:-1}}),/positive/);
 assert.throws(()=>checkedProceduralMesh({...r,surface:{...r.surface,fieldBinding:'missing'}}),/field/);
});
