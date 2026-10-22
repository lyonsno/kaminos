// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Matrix4, Vector3, Quaternion} from '../lib/three.core.js';
const module = await import('../experiments/hand-live-fluid.mjs').catch(error => {
  if(error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const frame = () => ({captureId:'observed-1',captureEpochMs:1000,source:'mobrecon_densestack_spiralconv',
  jointBasis:'upstream_j_reg_mano_to_mpii',acquisitionDetails:{fallback:false},
  meshJointsMeters:[[0,0,0],...Array.from({length:5},(_,f)=>Array.from({length:4},(_,j)=>[f*.02,j*.02,0])).flat()]});
const options = () => ({nowMs:1100,running:true,center:[0,0,0],matrix:new Matrix4().makeScale(5,5,5)});
test('native joints drive five distal jets without changing the source pose',()=>{
  assert.equal(typeof module.nativeFingerPacket,'function','native fingertip adapter is absent');
  const f=frame(),before=structuredClone(f),packet=module.nativeFingerPacket(f,options());
  assert.deepEqual(f,before);
  assert.equal(packet.emitters.filter(e=>e.active).length,5);
  assert.equal(packet.emitters.reduce((n,e)=>n+e.source_flux_particles_per_second,0),360);
  assert.deepEqual(packet.emitters[1].origin_world,[.1,-.3,0]);
  assert.deepEqual(packet.emitters[1].aim_world,[0,-1,0]);
  assert.equal(packet.source_frame_id,'observed-1');
  assert.equal(packet.route_identity,'mobrecon-native-mesh-finger-juice-v1');
});
test('fist, stale, stopped, detection miss and malformed joints cannot emit',()=>{
  assert.equal(typeof module.nativeFingerPacket,'function');
  for(const patch of [{nowMs:1800},{running:false}]){
    const p=module.nativeFingerPacket(frame(),{...options(),...patch});
    assert.equal(p.emitters.some(e=>e.active),false);assert.ok(p.authority.reason);
  }
  const f=frame();f.acquisitionDetails.fallback=true;
  assert.equal(module.nativeFingerPacket(f,options()).emitters.some(e=>e.active),false);
  f.acquisitionDetails.fallback=false;
  f.meshJointsMeters[7]=[.02,.02,.02];f.meshJointsMeters[8]=[.02,0,.02];
  assert.equal(module.nativeFingerPacket(f,options()).emitters[1].active,false);
  f.jointBasis='unknown';assert.throws(()=>module.nativeFingerPacket(f,options()),/joint basis/);
  f.jointBasis='upstream_j_reg_mano_to_mpii';f.meshJointsMeters[8][0]=NaN;
  assert.throws(()=>module.nativeFingerPacket(f,options()),/joints/);
});
test('shared world transform changes jet placement and direction, not extension',()=>{
  assert.equal(typeof module.nativeFingerPacket,'function');
  const matrix=new Matrix4().compose(new Vector3(1,2,3),new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2),new Vector3(5,5,5));
  const p=module.nativeFingerPacket(frame(),{...options(),matrix});
  assert.ok(Math.abs(p.emitters[1].origin_world[0]-1.3)<1e-10);
  assert.ok(Math.abs(p.emitters[1].aim_world[0]-1)<1e-10);
  assert.equal(p.emitters[1].extension,1);
});
