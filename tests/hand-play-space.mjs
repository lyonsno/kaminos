// kaminos-test: node
import assert from 'node:assert/strict';
import {Mesh,Vector3,Matrix4,Euler,Quaternion} from '../lib/three.core.js';
import {handPlayPlacement,playSpaceConfig,applyHandPlayPlacement} from '../experiments/hand-play-space.mjs';
import {mlsConfig} from '../mls-juice-contract.mjs';
import {createMlsGoinPile} from '../mls-goin-pile.mjs';
import {resolveMlsHandRequest,validateMlsHandRequest,validateMlsGoinRequest} from '../tools/mls-witness-source.mjs';
import {nativeFingerPacket} from '../experiments/hand-live-fluid.mjs';
import playground from '../experiments/hand-play-space.experiment.mjs';
import pileExperiment from '../experiments/hand-goin-pile.experiment.mjs';

// Local mapping policy fixture. Browser contract conformance is separately replayed.
const source={captureId:'mapping-fixture',pixelBasis:'unmirrored_camera',cropBox:[100,80,300,280],cropUV:Array(42).fill(.5),meshJointsMeters:[[.02,.03,.04]]};
const config=playSpaceConfig(),size={width:640,height:480};
assert.equal(config.pitchDegrees,0,'default must not impose an authored angle offset');
const a=handPlayPlacement(source,size,config);
assert.deepEqual(a.imageWrist,[200/640,180/480]);
assert.deepEqual(a.center,source.meshJointsMeters[0]);
const shifted=structuredClone(source);shifted.cropBox=[164,80,364,280];
const b=handPlayPlacement(shifted,size,config);
assert(Math.abs(b.position[0]-a.position[0]+.7)<1e-10,'camera movement must translate the glove');
assert.deepEqual(b.rotation,a.rotation);assert.equal(b.position[2],a.position[2],'crop position must not invent depth');
const curled=structuredClone(source);curled.cropUV[10]=.1;
assert.deepEqual(handPlayPlacement(curled,size,config).position,a.position,'finger articulation must not recenter the glove');
const mesh=new Mesh();applyHandPlayPlacement(mesh,a);
const up=new Vector3(0,1,0).transformDirection(mesh.matrixWorld);
assert(up.distanceTo(new Vector3(0,1,0))<1e-10,'zero offset must preserve the observed upright direction');
assert.equal(mesh.scale.x,-5,'translation and articulation must share mirror parity');
const joints=[source.meshJointsMeters[0],...Array.from({length:20},(_,i)=>[.02,.03-(i%4+1)*.02,.04])];
const packet=nativeFingerPacket({...source,meshJointsMeters:joints,source:'mobrecon_densestack_spiralconv',jointBasis:'upstream_j_reg_mano_to_mpii',captureEpochMs:100},
  {nowMs:100,running:true,center:a.center,matrix:mesh.matrixWorld});
assert(packet.emitters.every(e=>e.active),'placement must preserve extension');
const meshTip=new Vector3(0,.08,0).applyMatrix4(mesh.matrixWorld);
assert(meshTip.distanceTo(new Vector3(...packet.emitters[0].origin_world))<1e-10,'jet must leave the displayed fingertip');
assert(new Vector3(...packet.emitters[0].aim_world).distanceTo(up)<1e-10,'jet must follow the displayed finger');
const tilted=handPlayPlacement(source,size,playSpaceConfig({pitchDegrees:30}));
applyHandPlayPlacement(mesh,tilted);
const tiltedUp=new Vector3(0,1,0).transformDirection(mesh.matrixWorld);
assert(tiltedUp.distanceTo(new Vector3(0,Math.cos(Math.PI/6),-.5))<1e-10,'explicit angle offset remains tunable');
const tiltedPacket=nativeFingerPacket({...source,meshJointsMeters:joints,source:'mobrecon_densestack_spiralconv',jointBasis:'upstream_j_reg_mano_to_mpii',captureEpochMs:100},
  {nowMs:100,running:true,center:tilted.center,matrix:mesh.matrixWorld});
assert(new Vector3(...tiltedPacket.emitters[0].aim_world).distanceTo(tiltedUp)<1e-10,'optional offset must rotate glove and jets together');
applyHandPlayPlacement(mesh,handPlayPlacement(source,size,playSpaceConfig({pitchDegrees:0})));
assert(new Vector3(0,1,0).transformDirection(mesh.matrixWorld).distanceTo(up)<1e-10,'returning to zero removes the offset');
assert.throws(()=>handPlayPlacement({...source,cropUV:[]},size,config),/observation/);
assert.throws(()=>handPlayPlacement({...source,pixelBasis:'mirrored'},size,config),/pixel basis/);
assert.throws(()=>playSpaceConfig({depth:NaN}),/play space/);
assert.equal(handPlayPlacement({...source,acquisitionDetails:{fallback:true}},size,config).fallback,true);

// Preserve the accepted world mapping, including depth, at both mirror settings
// and optional offsets. The basis and placement must compose, not fix each other twice.
for(const mirror of [false,true])for(const pitchDegrees of [0,30,-25]){
  const cfg=playSpaceConfig({mirror,pitchDegrees});
  const placement=handPlayPlacement(source,size,cfg);applyHandPlayPlacement(mesh,placement);
  const points=[source.meshJointsMeters[0],...Array.from({length:20},(_,i)=>[.02+i*.003,.03-(i%4+1)*.02,.04+(i%4+1)*.013])];
  const actual=nativeFingerPacket({...source,meshJointsMeters:points,source:'mobrecon_densestack_spiralconv',jointBasis:'upstream_j_reg_mano_to_mpii',captureEpochMs:100},
    {nowMs:100,running:true,center:placement.center,matrix:mesh.matrixWorld});
  const accepted=new Matrix4().compose(new Vector3(...placement.position),new Quaternion().setFromEuler(new Euler(-pitchDegrees*Math.PI/180,0,0)),new Vector3(mirror?-5:5,5,5));
  const world=p=>new Vector3(p[0]-.02,-(p[1]-.03),p[2]-.04).applyMatrix4(accepted);
  for(let finger=0;finger<5;finger++){
    const tip=world(points[4+finger*4]),distal=world(points[3+finger*4]);
    assert(tip.distanceTo(new Vector3(...actual.emitters[finger].origin_world))<1e-10,'accepted fingertip position changed');
    assert(tip.sub(distal).normalize().distanceTo(new Vector3(...actual.emitters[finger].aim_world))<1e-10,'accepted pointing direction changed');
  }
}

const centers=[[-1.8,-1.3],[-.6,-2.1],[.6,-2.1],[1.8,-1.3]];
const pile=createMlsGoinPile(mlsConfig({gridSize:[192,80,256],goinPile:{count:24,stackCenters:centers}}));
assert.deepEqual(pile.read().bodies.slice(0,4).map(b=>[b.position[0],b.position[2]]),centers,'authored broad layout was ignored');
pile.dispose();
assert.throws(()=>mlsConfig({goinPile:{stackCenters:[]}}),/stack centers/);
assert.throws(()=>mlsConfig({goinPile:{stackCenters:[[0,NaN]]}}),/stack centers/);
assert.equal(resolveMlsHandRequest('hand-play-space',{}).playSpace.pitchDegrees,0,'witness must resolve the neutral default route');
assert.equal(resolveMlsHandRequest('hand-play-space',{playSpace:{pitchDegrees:30}}).playSpace.pitchDegrees,30,'explicit requested offset must survive route resolution');
assert.deepEqual(resolveMlsHandRequest('hand-play-space',{goinPile:{mass:.5}}).goinPile.stackCenters,centers,'mass edit must retain the court layout');
assert.throws(()=>validateMlsHandRequest({playSpace:null},{playSpace:{}}),/config mismatch/);
assert.throws(()=>validateMlsHandRequest({playSpace:{config,observation:null}},{playSpace:{}}),/missing play space/);
assert.throws(()=>validateMlsHandRequest({captureId:'new',playSpace:{config,observation:a}},{playSpace:{}}),/stale play space/);
const layoutPile=createMlsGoinPile(mlsConfig({goinPile:{count:4,stackCenters:centers}}));
const effective=layoutPile.read();layoutPile.dispose();
validateMlsGoinRequest(effective,{count:4,stackCenters:centers});
assert.throws(()=>validateMlsGoinRequest({...effective,stackCenters:null},{count:4,stackCenters:centers}),/layout mismatch/);
const create=pileExperiment.create;let actualInputs,markings,disposed=0;
try{
  pileExperiment.create=async({inputs})=>{actualInputs=inputs;return {read:()=>({}),dispose:async()=>{disposed++;}};};
  const host={scene:{open:async()=>({attach:async group=>{markings=group;},redraw(){},dispose:async()=>{disposed++;}})}};
  const instance=await playground.create({host,inputs:{goinPile:{count:12}},record(){}});
  assert.equal(actualInputs.goinPile.count,12);
  assert.deepEqual(markings.children.map(r=>[r.position.x,r.position.z]),actualInputs.goinPile.stackCenters,'inlays must match the effective pile layout');
  await instance.dispose();assert.equal(disposed,2);
}finally{pileExperiment.create=create;}
console.log('Camera-plane mapping, coherent tilt/mirror, stable wrist anchor and broad goin layout');
