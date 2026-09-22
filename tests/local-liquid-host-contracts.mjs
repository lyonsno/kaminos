import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fluid from '../finger-fluid-webgpu-core.js';

// The camera and attachment contract is the retained 703e759a host API.
// This fixture tests local admission policy, not browser/GPU conformance.
const matrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const device = {};
const camera = {schema:'kaminos.finger-fluid.external-camera.v0',identity:'author-camera',generation:1,
  projectionType:'orthographic',view:matrix,projection:matrix,viewProjection:matrix,inverseViewProjection:matrix,
  position:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,-1],near:.1,far:100,viewport:{width:640,height:480}};
function frame() {
  const attachment = (attachmentId,extra) => ({authority:'host_live_frame',attachmentId,frameId:'frame-1',
    cameraIdentity:camera.identity,cameraGeneration:1,deviceIdentity:'author-device',width:640,height:480,view:{},...extra});
  const route='kaminos/finger-fluid/local-analytic-host-frame-v0';
  return {schema:'kaminos.finger-fluid.local-analytic-host-frame.v0',frameId:'frame-1',device,deviceIdentity:'author-device',
    commandEncoder:{},width:640,height:480,camera,pipelineIdentity:'author-pipeline',remapGeneration:0,
    supportIdentity:fluid.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE,
    route:{requested:route,effective:route,fallback:null},
    sceneColor:attachment('color',{format:'rgba16float',colorSpace:'linear_hdr'}),
    sceneDepth:attachment('depth',{format:'r32float',encoding:'linear_view_depth_meters'}),
    environment:attachment('environment',{format:'rgba16float',mapping:'equirectangular_world_radiance'}),
    target:attachment('target',{format:'rgba16float',colorSpace:'linear_hdr'})};
}
const options={device,camera,extent:{width:640,height:480},expectedPipelineIdentity:'author-pipeline'};
test('local analytical support has explicit host admission without Hill authority',()=>{
  assert.equal(fluid.resolveFingerFluidPresentationMode('local_analytic_consumer'),'local_analytic_consumer');
  const result=fluid.validateFingerFluidLocalHostFrame(frame(),options);
  assert.equal(result.route.effective,'kaminos/finger-fluid/local-analytic-host-frame-v0');
  assert.equal(result.schema,'kaminos.finger-fluid.local-analytic-host-frame.v0');
  assert.equal(result.supportIdentity,fluid.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE);
  assert.throws(()=>fluid.validateFingerFluidMovingHillHostFrame(frame(),{...options,expectedRemapGeneration:0}),/schema/);
});
test('local frame retains device, camera, attachment, route and support checks',()=>{
  for(const mutate of [
    f=>{f.device={};},f=>{f.sceneDepth.frameId='stale';},f=>{f.target.view=f.sceneColor.view;},
    f=>{f.camera={...camera,generation:2};},f=>{f.route.effective='fallback';},
    f=>{f.supportIdentity='arbitrary-mesh-collision';},f=>{f.remapGeneration=1;},
    f=>{f.sceneDepth.encoding='device_depth';},f=>{f.environment.authority='cached-fallback';},
  ]) {
    const input=frame();mutate(input);
    assert.throws(()=>fluid.validateFingerFluidLocalHostFrame(input,options),error=>{
      assert.equal(error.report?.primaryOutputWritten,false);
      assert.equal(error.report?.effectiveRoute,null);
      return true;
    });
  }
});
