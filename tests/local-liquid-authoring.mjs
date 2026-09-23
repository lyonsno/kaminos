import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildSceneDocument,planSceneRestore,sceneDocumentIsLoadable} from '../scene-persistence-core.js';
import {defaultLocalLiquidSetup,normalizeLocalLiquidSetup,normalizeLocalLiquidEmitter,localLiquidInletPacket} from '../local-liquid-setup.mjs';
import {normalizeFingerFluidLiveInletPacket} from '../finger-fluid-webgpu-core.js';

const emitter={id:'water-emitter-test',schema:'kaminos.local-liquid-emitter.v1',source:'kaminos:local-liquid-emitter',
  type:'local-liquid-emitter',fileName:'Water emitter',label:'Water emitter',
  transform:{position:[-.35,.4,-1.65],rotation:[Math.atan2(.25,1),0,0],scale:[1,1,1]},
  localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',baseRadius:.08,strength:1.15,rate:1200}};

test('a liquid scene persists support globally and keeps emitter identity and pose in its object record',()=>{
  const setup=defaultLocalLiquidSetup();
  const saved=buildSceneDocument({objects:[emitter],activeObjectId:emitter.id,localLiquid:setup,camera:{position:[1,2,3],target:[0,0,0]}});
  assert.equal(saved.localLiquid.schema,'kaminos.local-liquid-setup.v1');
  assert.equal(Object.hasOwn(saved.localLiquid,'source'),false);
  assert.equal(sceneDocumentIsLoadable(saved),true);
  const restored=planSceneRestore(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.objects.length,1);
  assert.equal(restored.objects[0].id,emitter.id);
  assert.deepEqual(restored.objects[0].transform,emitter.transform);
  assert.deepEqual(restored.objects[0].localLiquidEmitter,emitter.localLiquidEmitter);
  assert.equal(restored.localLiquid.particleCount,49152);
  assert.equal(restored.localLiquid.support,'retained_analytical_basin');
  assert.equal(restored.localLiquid.particleState,undefined);
});

test('malformed support or emitter settings fail loudly during saved-scene restore',()=>{
  const setup=defaultLocalLiquidSetup();
  assert.throws(()=>normalizeLocalLiquidSetup({...setup,support:'mesh_collision'}),/support/);
  assert.throws(()=>normalizeLocalLiquidEmitter({...emitter.localLiquidEmitter,rate:-1},emitter.transform),/rate/);
  assert.throws(()=>normalizeLocalLiquidEmitter({...emitter.localLiquidEmitter,baseRadius:.3},emitter.transform),/baseRadius/);
  assert.throws(()=>normalizeLocalLiquidEmitter(emitter.localLiquidEmitter,{...emitter.transform,scale:[2,1,1]}),/uniform scale/);
  assert.throws(()=>planSceneRestore(buildSceneDocument({objects:[emitter]})),/local liquid setup/);
});

test('scene-object scale, orientation and rate reach the retained live-inlet contract',()=>{
  const setup=defaultLocalLiquidSetup();
  const placed={...emitter,transform:{...emitter.transform,scale:[1.25,1.25,1.25]},
    localLiquidEmitter:{...emitter.localLiquidEmitter,rate:800}};
  const packet=localLiquidInletPacket(setup,[placed],4);
  const inlet=normalizeFingerFluidLiveInletPacket(packet).inlets[0];
  assert.equal(packet.emitters[0].source_flux_particles_per_second,800);
  assert.deepEqual(inlet.origin,placed.transform.position);
  assert.ok(Math.abs(inlet.radius-.1)<1e-12,'uniform scene scale changes the emitted aperture');
  assert.ok(Math.abs(inlet.maximumSpeed-emitter.localLiquidEmitter.strength)<1e-12);
  assert.ok(inlet.axis[1]<0 && inlet.axis[2]>0,'the object rotation sets the jet direction');
});
