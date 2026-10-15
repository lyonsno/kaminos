// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('disabled authored emission survives serialization and source registration',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const context={structuredClone,sceneObjects:[],sceneNavigation:null,window:{},
    LOCAL_LIQUID_EMITTER_TYPE:'water',FLAME_EMITTER_TYPE:'flame',CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'mesh',
    checkedObjectCollision:()=>null,canCollideWithFire:()=>false,setActiveSceneObject(){},
    sceneObjectMetadataFor:object=>object.userData.kaminosSceneObject,
    sceneObjectTransformState:()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}),getMaterialStateForObject:()=>[]};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function registerSceneObject('),source.indexOf('window.selectSceneField='))+
    source.slice(source.indexOf('function serializeSceneObject('),source.indexOf('function readNumberControl(')),context);
  const object={userData:{}};
  const original=context.registerSceneObject(object,{id:'flame-emitter',type:'flame',emissionEnabled:false});
  const saved=context.serializeSceneObject(original);
  assert.equal(saved.emissionEnabled,false);
  const restored=context.registerSceneObject({userData:{}},JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.emissionEnabled,false);assert.equal(restored.object.userData.kaminosSceneObject.emissionEnabled,false);
  assert.equal(context.registerSceneObject({userData:{}},{id:'old-flame',type:'flame'}).emissionEnabled,true);
});

test('actual experiment adapter restores a removed source without starting it',async()=>{
  const source=readFileSync(new URL('../experiments/sinter/live-log-heat.experiment.mjs',import.meta.url),'utf8');
  let present=false,enabled=true,adds=0,adapter;
  const session={dispose:async()=>{}};
  const host={scene:{open:async()=>session},volume:{ready:Promise.resolve(),get:()=>({setSimulationPaused(){},debugState:()=>({simGrid:32,gridHeight:{heightCells:32}})})},
    fire:{settings:()=>({source:{presetId:'saved'},domControls:{'volume-steps':{value:28},'volume-immersed-radius':{value:.1}}}),
      add:async()=>{adds++;present=true;},setEnabled:value=>{enabled=value;},read:()=>({authoredPresent:present,emissionEnabled:enabled})},rendering:{gi(){}}};
  const context={createLiveLogExperiment:async args=>{adapter=args.host.fire;return {dispose:async()=>{}};}};vm.createContext(context);
  vm.runInContext(source.replace(/^import .*;\n/gm,'').replace('export default','globalThis.definition='),context);
  await context.definition.create({host,inputs:{},record(){}});
  present=false;assert.equal(adapter.availability().status,'unavailable');
  await adapter.reacquire();
  assert.equal(adapter.availability().status,'mounted');assert.equal(adds,2);assert.equal(enabled,false);
});
