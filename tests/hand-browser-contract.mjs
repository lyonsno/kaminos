// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Matrix4} from '../lib/three.core.js';
import {liveMeshFrame} from '../experiments/hand-live-contract.mjs';
import {nativeFingerPacket,idleFingerPacket} from '../experiments/hand-live-fluid.mjs';
const adapter=await import('../experiments/hand-browser-contract.mjs').catch(error=>{
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};
});
const order=[0,13,14,15,20,1,2,3,16,4,5,6,17,10,11,12,19,7,8,9,18];
const regressor=Array.from({length:21},(_,j)=>Array.from({length:778},(_,v)=>Number(j===v)));
const capture={captureId:'frame-1',captureEpochMs:1000,acquisitionMode:'detector',cropPadding:1.4,detectorThreshold:.18};
const identity={routeId:'kaminos.browser-hand-mesh.webgpu-local.v0',backend:'webgpu-local',device:'browser-gpu',interactionAuthority:false,
  mobrecon:{modelId:'mobrecon.densestack-spiralconv',provenance:{sourceRevision:'observed-source',checkpointSha256:'observed-weights'}},
  detector:{modelId:'wilor-hand-detector.yolov8m-pose',bundleSha256:'detector-weights'}};
const prediction=()=>({identity,handedness:'right',hasHand:true,interactionAuthority:false,authority:'browser_webgpu_diagnostic_not_interaction',
  verticesMeters:Float32Array.from({length:778*3},(_,i)=>i*.001),nativeVertices:new Float32Array(778*3),nativeUV:new Float32Array(42),cropUV:new Float32Array(42),
  cropBox:[1,2,101,102],acquisition:{mode:'detector',padding:1.4,threshold:.18,detections:[{confidence:.5}],fallback:false,source:'wilor_yolo_detector_bbox_only'},timings:{totalMs:10}});
test('browser adapter exists and preserves the upstream joint order without changing the mesh',()=>{
  assert.equal(typeof adapter.regressMeshJoints,'function','browser mesh-joint adapter is absent');
  const vertices=prediction().verticesMeters,before=vertices.slice();
  const joints=adapter.regressMeshJoints(vertices,regressor);
  for(let j=0;j<21;j++)assert.deepEqual(joints[j],Array.from(vertices.slice(order[j]*3,order[j]*3+3)));
  assert.deepEqual(vertices,before);
  const mirrored=vertices.map((x,i)=>i%3===0?-x:x);
  assert.deepEqual(adapter.regressMeshJoints(mirrored,regressor),joints.map(([x,y,z])=>[x===0?0:-x,y,z]));
  assert.throws(()=>adapter.regressMeshJoints(vertices,regressor.slice(1)),/regressor/);
});
test('browser envelope passes display validation with distinct route and action identity',()=>{
  assert.equal(typeof adapter.browserHandFrame,'function','browser envelope adapter is absent');
  const p=prediction(),frame=adapter.browserHandFrame(p,capture,regressor,'regressor-sha');
  assert.equal(frame.identity.backend,'webgpu-local');
  assert.equal(frame.identity.device,'browser-gpu');
  assert.equal(frame.identity.routeId,identity.routeId);
  assert.equal(frame.interactionAuthority,false);
  assert.deepEqual(liveMeshFrame(frame,capture,frame.identity),p.verticesMeters);
  const packet=nativeFingerPacket(frame,{nowMs:1100,running:true,center:[0,0,0],matrix:new Matrix4()});
  assert.equal(packet.route_identity,'mobrecon-browser-mesh-finger-juice-v1');
  assert.equal(packet.source_identity.backend,'webgpu-local');
  const fallback=prediction();fallback.acquisition.detections=[];fallback.acquisition.fallback=true;fallback.acquisition.source='manual_crop_fallback_no_detection';
  const missing=adapter.browserHandFrame(fallback,capture,regressor,'regressor-sha');
  assert.equal(liveMeshFrame(missing,capture,missing.identity).length,2334,'fallback mesh remains diagnostic evidence');
  assert.equal(nativeFingerPacket(missing,{nowMs:1100,running:true,center:[0,0,0],matrix:new Matrix4()}).emitters.some(x=>x.active),false);
  const nativeMasquerade={...frame,authority:'live_native_diagnostic_not_interaction'};
  assert.throws(()=>liveMeshFrame(nativeMasquerade,capture,frame.identity),/authority/);
  p.identity={...identity,backend:'pytorch'};
  assert.throws(()=>adapter.browserHandFrame(p,capture,regressor,'regressor-sha'),/route/);
});
test('idle browser water never claims the native route',()=>{
  assert.equal(idleFingerPacket('no_sample','mobrecon-browser-mesh-finger-juice-v1').route_identity,'mobrecon-browser-mesh-finger-juice-v1');
});
