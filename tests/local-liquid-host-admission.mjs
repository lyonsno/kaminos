import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fluid from '../finger-fluid-webgpu-core.js';

const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const device = {};
const camera = {schema:'kaminos.finger-fluid.external-camera.v0',identity:'authored-camera',generation:1,
  projectionType:'orthographic',view:identity,projection:identity,viewProjection:identity,inverseViewProjection:identity,
  position:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,-1],near:.1,far:100,viewport:{width:640,height:480}};
function localHostFrame() {
  const attachment=(attachmentId,extra)=>({authority:'host_live_frame',attachmentId,frameId:'local-frame-1',
    cameraIdentity:camera.identity,cameraGeneration:camera.generation,deviceIdentity:'kaminos-local-host',width:640,height:480,view:{},...extra});
  const route='kaminos/finger-fluid/local-analytic-host-frame-v0';
  return {schema:'kaminos.finger-fluid.local-analytic-host-frame.v0',frameId:'local-frame-1',device,
    deviceIdentity:'kaminos-local-host',commandEncoder:{},width:640,height:480,camera,pipelineIdentity:'kaminos-local-liquid',
    remapGeneration:0,supportIdentity:fluid.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE,
    route:{requested:route,effective:route,fallback:null},
    sceneColor:attachment('color',{format:'rgba16float',colorSpace:'linear_hdr'}),
    sceneDepth:attachment('depth',{format:'r32float',encoding:'linear_view_depth_meters'}),
    environment:attachment('environment',{format:'rgba16float',mapping:'equirectangular_world_radiance'}),
    target:attachment('target',{format:'rgba16float',colorSpace:'linear_hdr'})};
}

test('authored liquid accepts the bounded retained analytical support on the host frame',()=>{
  assert.equal(fluid.resolveFingerFluidPresentationMode('local_analytic_consumer'),'local_analytic_consumer');
  assert.equal(typeof fluid.validateFingerFluidLocalHostFrame,'function');
  const validated=fluid.validateFingerFluidLocalHostFrame(localHostFrame(),{
    device,camera,extent:{width:640,height:480},expectedPipelineIdentity:'kaminos-local-liquid',
  });
  assert.equal(validated.route.effective,'kaminos/finger-fluid/local-analytic-host-frame-v0');
  assert.equal(validated.supportIdentity,fluid.KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE);
  assert.throws(()=>fluid.validateFingerFluidMovingHillHostFrame(localHostFrame(),{
    device,camera,extent:{width:640,height:480},expectedPipelineIdentity:'kaminos-local-liquid',expectedRemapGeneration:0,
  }),/schema/);
});
