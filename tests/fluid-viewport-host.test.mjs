import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PerspectiveCamera,OrthographicCamera,WebGPUCoordinateSystem} from '../lib/three.core.js';
import {validateFingerFluidExternalCamera} from '../finger-fluid-webgpu-core.js';
const load=()=>import('../fluid-viewport-host.mjs').catch(()=>({}));
test('ordinary bench uses the shared viewport and a producer view requires an explicit request',async()=>{
 const m=await load();assert.equal(typeof m.resolveFluidViewportMode,'function','bench must choose an explicit viewport owner');
 assert.equal(m.resolveFluidViewportMode(new URLSearchParams()),'shared');
 assert.equal(m.resolveFluidViewportMode(new URLSearchParams('finger_fluid_viewport=producer')),'producer');
 assert.throws(()=>m.resolveFluidViewportMode(new URLSearchParams('finger_fluid_viewport=unknown')),/viewport/);
});
test('shared fluid camera frames retain the actual host projection, pose, identity and extent',async()=>{
 const m=await load();assert.equal(typeof m.fluidViewportCameraFrame,'function');
 for(const orthographic of [false,true]){
  const camera=orthographic?new OrthographicCamera(-2,2,1.5,-1.5,.1,100):new PerspectiveCamera(60,4/3,.1,100);
  camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.set(.8,-.3,1.2);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
  const frame=m.fluidViewportCameraFrame(camera,640,480,4),validated=validateFingerFluidExternalCamera(frame,{width:640,height:480});
  assert.equal(validated.identity,camera.uuid);assert.equal(validated.generation,4);assert.equal(validated.projectionType,orthographic?'orthographic':'perspective');
  assert.deepEqual(frame.position,camera.position.toArray());
 }
});
test('authored water and the bench consume the same render-host adapter',()=>{
 const authored=readFileSync(new URL('../local-liquid-host.mjs',import.meta.url),'utf8');
 const bench=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(authored,/createFluidViewportHost/,'authored water should use the reusable camera/depth/environment/presentation component');
 assert.match(bench,/createFluidViewportHost/,'ordinary bench should bind the same viewport component');
 assert.doesNotMatch(authored,/new THREE\.RenderTarget/,'authored water must not maintain a second copy of scene capture');
});
