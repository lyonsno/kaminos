// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {checkedSceneLightRecord} from '../scene-spot-light.mjs';
import {sceneContext} from './helpers/scene-context.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function context(){
 const c=sceneContext({THREE,checkedSceneLightRecord,scene:new THREE.Scene(),rimLight:new THREE.SpotLight(),RIM_LIGHT_ID:'@rim-light',viewportHelpersVisible:true,window:{},
  applySceneObjectTransformState(object,pose){object.position.fromArray(pose.position);object.rotation.set(...pose.rotation);object.scale.fromArray(pose.scale);}});
 const start=html.indexOf('const sceneSpotLights=new Map();'),end=html.indexOf('function groupPivotPose(',start);
 vm.runInContext(html.slice(start,end),c);return c;
}
const record=(id='@rim-light')=>({id,type:'light',source:'kaminos:scene-spot-light',label:'Saved light',transform:{position:[2,3,4],rotation:[-.6,.7,0],scale:[1,1,1]},light:{kind:'spot',enabled:true,color:'#f0e0d0',intensity:123.456,angle:35,penumbra:.23,aimDistance:6}});
test('an old light identity receives its own ordinary binding rather than the startup singleton',()=>{
 const c=context(),entry=c.mountSceneSpotLight(record()),binding=c.scene.children.find(object=>object.isSpotLight);
 assert.notEqual(binding,c.rimLight,'legacy identity must not select a hidden singleton');
 assert.equal(binding.intensity,123.456);assert.equal(entry.label,'Saved light');
 assert.deepEqual(binding.position.toArray(),[2,3,4]);assert.equal(c.workingScene.objects.length,1);
});
test('disposing a formerly reserved light releases its entire runtime binding',()=>{
 const c=context();c.mountSceneSpotLight(record());const light=c.scene.children.find(object=>object.isSpotLight),target=light.target;
 c.disposeSceneSpotLight('@rim-light');
 assert.equal(light.parent,null,'removed authored illumination must leave the scene');assert.equal(target.parent,null);assert.equal(c.window.kaminosSceneLightState().length,0);
});
test('old and ordinary light identities independently retain properties and updated poses',()=>{
 const c=context();for(const id of ['@rim-light','ordinary'])c.mountSceneSpotLight(record(id));
 c.mountSceneSpotLight({...record(),label:'Key',transform:{...record().transform,position:[4,5,6]},light:{...record().light,enabled:false,intensity:2.75}});
 const rows=c.window.kaminosSceneLightState();assert.equal(rows.length,2);assert.equal(rows.find(row=>row.id==='@rim-light').visible,false);assert.equal(rows.find(row=>row.id==='ordinary').power,123.456);
 assert.deepEqual(rows.find(row=>row.id==='@rim-light').position,[4,5,6]);assert.equal(c.workingScene.find('@rim-light').label,'Key');
});

import {getSceneObjectRecords,buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
test('legacy spherical light converts once to ordinary pose and survives modern save/reopen',()=>{
 const recipe={enabled:true,color:'#abcdef',intensity:123.456,distance:6.125,azimuth:135,elevation:30,target:[1,2,3],angle:45.67,penumbra:.1234};
 const [light]=getSceneObjectRecords({version:6,objects:[],environment:{rimLight:recipe}});
 const c=context();c.mountSceneSpotLight(light);
 const direction=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(...light.transform.rotation));
 const actualTarget=new THREE.Vector3(...light.transform.position).addScaledVector(direction,recipe.distance);
 for(let axis=0;axis<3;axis++)assert.ok(Math.abs(actualTarget.toArray()[axis]-recipe.target[axis])<1e-9);
 const doc=buildSceneDocument({objects:[{...light,label:'Key'}],environment:{name:'studio'}}),restored=planSceneRestore(doc).objects;
 assert.equal(restored.length,1);assert.equal(restored[0].id,'@rim-light');assert.equal(restored[0].label,'Key');assert.equal(restored[0].light.intensity,123.456);assert.deepEqual(restored[0].transform,light.transform);assert.equal('rimLight' in doc.environment,false);
 assert.equal(getSceneObjectRecords({...doc,environment:{rimLight:recipe}}).length,1,'modern object list owns its lights without duplicating a stale environment recipe');
});
test('legacy off remains absent and pole directions preserve their saved targets',()=>{
 const base={enabled:true,color:'#ffffff',intensity:120,distance:6,azimuth:0,elevation:0,target:[1,2,3],angle:35,penumbra:.65};
 assert.equal(getSceneObjectRecords({version:6,objects:[],environment:{rimLight:{...base,enabled:false}}}).length,0);
 for(const elevation of [-90,90]){
  const [light]=getSceneObjectRecords({version:6,objects:[],environment:{rimLight:{...base,elevation}}});
  const c=context();c.mountSceneSpotLight(light);const actual=c.window.kaminosSceneLightState()[0];
  actual.target.forEach((v,i)=>assert.ok(Math.abs(v-base.target[i])<1e-9));
 }
 assert.throws(()=>getSceneObjectRecords({version:6,objects:[],environment:{rimLight:{...base,distance:0}}}),/legacy rim light range/);
});

test('creature shadow witness rejects missing, substituted and unapplied ordinary light state',()=>{
 const source=fs.readFileSync(new URL('../tools/creature-controls-witness.mjs',import.meta.url),'utf8');
 const begin=source.indexOf('   // Check the authored shadow light before reading the creature frame.');
 const end=source.indexOf('report.shadowRead=await read()',begin);
 const code=begin<0?'':source.slice(begin,end),requested={id:'authored',intensity:160,position:[3,4,5],target:[0,-1,-1]};
 const good={id:'authored',visible:true,power:160,position:[3,4,5],target:[0,-1,-1]};
 const verify=effective=>vm.runInNewContext(code,{assert,report:{shadowLight:{requested,effective}}});
 for(const rows of [[],[{...good,id:'fallback'}],[{...good,visible:false}],[{...good,power:30}],[{...good,position:[0,0,0]}],[{...good,target:[1,0,0]}]])assert.throws(()=>verify(rows),'missing or substituted shadow light cannot count as an exercised light');
 verify([good]);
});
