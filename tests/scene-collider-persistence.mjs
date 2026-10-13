// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {createFireDomainRecord} from '../scene-fire-domain.mjs';
const settings={domControls:{'volume-resolution':{value:32}},rendererControls:{},presentationControls:{}};
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+ 'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1',volume_collision:'kiln'}};
const domain=()=>createFireDomainRecord({settings});
const wall=()=>({id:'baffle',type:'glb',source:'/baffle.glb',collision:{domainId:'flame-field',enabled:true},transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]}});
test('scene saves and restoration preserve object collision membership separately from its geometry and source',()=>{
 const doc=buildSceneDocument({objects:[wall(),domain()],fireSettings:settings,composition});
 assert.deepEqual(doc.objects.find(o=>o.id==='baffle').collision,{domainId:'flame-field',enabled:true});
 const restored=planSceneRestore(doc).objects.find(o=>o.id==='baffle');
 assert.deepEqual(restored.collision,wall().collision);assert.equal(restored.source,'/baffle.glb');
 assert.ok(doc.version>9,'the scene version identifies its authored collision interpretation');
});
test('collision data refuses a missing domain, a retyped enabled flag and a non-mesh owner',()=>{
 assert.throws(()=>buildSceneDocument({objects:[wall()]}),/collision.*domain|domain.*collision/i);
 assert.throws(()=>buildSceneDocument({objects:[{...wall(),collision:{domainId:'flame-field',enabled:1}},domain()]}),/collision/i);
 assert.throws(()=>buildSceneDocument({objects:[{...wall(),type:'image'},domain()]}),/collision/i);
});

test('legacy kiln collision becomes object membership, while a current explicit opt-out survives reopening',()=>{
 const legacy=buildSceneDocument({objects:[{...wall(),id:'kiln',collision:null}],fireSettings:settings,composition});legacy.version=9;delete legacy.objects[0].collision;
 assert.deepEqual(planSceneRestore(legacy).objects[0].collision,{domainId:'flame-field',enabled:true});
 const current=buildSceneDocument({objects:[{...wall(),id:'kiln',collision:null}],fireSettings:settings,composition});
 assert.equal(planSceneRestore(current).objects[0].collision,null);
 assert.throws(()=>planSceneRestore({...current,version:current.version+1}),/newer authoring client/);
});

test('the observed version-8 kiln recipe restores its implicit fire domain before adopting collision membership',()=>{
 const object={...wall(),id:'kiln'};delete object.collision;
 const legacy={version:8,objects:[object],composition,flameDomainTranslation:[.036190740727542636,-.08796791229906509,1.2975528287866451],flameDomainScale:1.1315854291256993,flameDomainFollowSource:false};
 const restored=planSceneRestore(legacy);assert.deepEqual(restored.objects[0].collision,{domainId:'flame-field',enabled:true});assert.equal(restored.composition.flame.presetId,composition.flame.presetId);
});
