import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildSceneDocument,planSceneRestore,sceneDocumentIsLoadable} from '../scene-persistence-core.js';
import {defaultLocalLiquidSetup,localLiquidInletPacket,normalizeLocalLiquidSetup} from '../local-liquid-setup.mjs';
import {normalizeFingerFluidLiveInletPacket} from '../finger-fluid-webgpu-core.js';

const setup={schema:'kaminos.local-liquid-setup.v0',support:'retained_analytical_basin',
  particleCount:49152,densityIterations:3,
  source:{x:-.35,y:.4,z:-1.65,radius:.08,strength:1.15,rate:1200}};
test('a liquid-only scene preserves authored setup through the real scene document',()=>{
  const saved=buildSceneDocument({localLiquid:setup,camera:{position:[1,2,3],target:[0,0,0]}});
  assert.equal(saved.localLiquid?.source.rate,1200);
  assert.equal(sceneDocumentIsLoadable(saved),true);
  const restored=planSceneRestore(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.localLiquid.source.x,-.35);
  assert.equal(restored.localLiquid.particleCount,49152);
  assert.equal(restored.localLiquid.support,'retained_analytical_basin');
  assert.equal(restored.localLiquid.particleState,undefined);
  setup.source.x=2;
  assert.equal(saved.localLiquid.source.x,-.35);
});
test('malformed or unsupported liquid state cannot silently disappear on reopen',()=>{
  const scene={version:3,objects:[],localLiquid:{...setup,source:{...setup.source,rate:-1}}};
  assert.throws(()=>planSceneRestore(scene),/source.rate/);
  assert.throws(()=>planSceneRestore({...scene,localLiquid:{...setup,support:'mesh_collision'}}),/support/);
});
test('authored aperture and speed reach the retained inlet without hidden scaling or clamping',()=>{
  const authored=defaultLocalLiquidSetup();
  const inlet=normalizeFingerFluidLiveInletPacket(localLiquidInletPacket(authored,1)).inlets[0];
  assert.ok(Math.abs(inlet.radius-authored.source.radius)<1e-12,'aperture must match the effective source radius');
  assert.ok(Math.abs(inlet.maximumSpeed-authored.source.strength)<1e-12,'speed must match the effective source speed');
  assert.throws(()=>normalizeLocalLiquidSetup({...authored,source:{...authored.source,radius:.3}}),/radius/);
});
