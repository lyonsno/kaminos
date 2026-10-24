// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {getSceneObjectRecords} from '../scene-persistence-core.js';
import {FLAME_EMITTER_ID,FLAME_EMITTER_TYPE,FLAME_EMITTER_SOURCE} from '../scene-flame-emitter.mjs';

test('canonical scene normalization preserves disabled source state and refuses retyped state',()=>{
  const record={id:FLAME_EMITTER_ID,type:FLAME_EMITTER_TYPE,source:FLAME_EMITTER_SOURCE,emissionEnabled:false};
  const restore=object=>getSceneObjectRecords({version:10,objects:[object]})[0];
  assert.equal(restore(record).emissionEnabled,false);
  assert.throws(()=>restore({...record,emissionEnabled:'false'}),/emission enabled/);
  const old={...record};delete old.emissionEnabled;assert.equal(restore(old).emissionEnabled,true);
});

test('disabled authored emission survives serialization and source registration',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const context={structuredClone,sceneObjects:[],sceneNavigation:null,window:{},
    createSceneObjectRecord,LOCAL_LIQUID_EMITTER_TYPE:'water',FLAME_EMITTER_TYPE,CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'mesh',
    checkedObjectCollision:()=>null,canCollideWithFire:()=>false,setActiveSceneObject(){},giProxySettingFor:()=>null,applyGiProxySetting(){},
    sceneObjectMetadataFor:object=>object.userData.kaminosSceneObject,
    sceneObjectTransformState:()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}),getMaterialStateForObject:()=>[]};
  sceneContext(context);
  vm.runInContext(source.slice(source.indexOf('function registerSceneObject('),source.indexOf('window.selectSceneField='))+
    source.slice(source.indexOf('function serializeSceneObject('),source.indexOf('function readNumberControl(')),context);
  const object={userData:{}};
  const original=context.registerSceneObject(object,{id:'flame-emitter',type:FLAME_EMITTER_TYPE,emissionEnabled:false});
  const saved=context.serializeSceneObject(original);
  assert.equal(saved.emissionEnabled,false);
  const restored=context.registerSceneObject({userData:{}},JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.emissionEnabled,false);assert.equal(restored.object.userData.kaminosSceneObject.emissionEnabled,false);
  assert.equal(context.registerSceneObject({userData:{}},{id:'old-flame',type:FLAME_EMITTER_TYPE}).emissionEnabled,true);
});

test('actual experiment adapter restores a removed source without starting it',async()=>{
  const source=readFileSync(new URL('../experiments/sinter/live-log-heat.experiment.mjs',import.meta.url),'utf8');
  let present=false,enabled=true,visible=true,adds=0,adapter,inspect,collision=false;
  const session={dispose:async()=>{}};
  const host={scene:{open:async()=>session},volume:{ready:Promise.resolve(),get:()=>({setSimulationPaused(){},debugState:()=>({simGrid:32,gridHeight:{heightCells:32}})})},
    fire:{settings:()=>({source:{presetId:'saved'},domControls:{'volume-steps':{value:28},'volume-immersed-radius':{value:.1}}}),
      add:async()=>{adds++;present=true;},setVisible:value=>{visible=value;},setEnabled:value=>{enabled=value;},read:()=>({authoredPresent:present,emissionEnabled:enabled})},rendering:{gi(){},readGI:()=>({gain:10}),readFireLighting:()=>({witnessMuted:false}),muteFireLighting(){}}};
  const context={kaminosSceneCollision:{set:value=>{collision=value;}},createLiveLogExperiment:async args=>{adapter=args.host.fire;inspect=args.host.inspection;return {dispose:async()=>{}};}};sceneContext(context);
  vm.runInContext(source.replace(/^import .*;\n/gm,'').replace('export default','globalThis.definition='),context);
  await context.definition.create({host,inputs:{},record(){}});
  assert.equal(collision,true,'the ordinary entry must enable the collisions used by its native witness');
  collision=false;
  present=false;assert.equal(adapter.availability().status,'unavailable');
  await adapter.reacquire();
  assert.equal(collision,true,'reconnecting a fire must restore the experiment collision setup');
  assert.equal(adapter.availability().status,'mounted');assert.equal(adds,2);assert.equal(enabled,false);
  inspect(true);assert.equal(visible,false);assert.equal(adapter.read().visible,false);
  inspect(false);assert.equal(visible,true);assert.equal(adapter.read().visible,true);
});
