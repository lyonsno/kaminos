// kaminos-test: node
import assert from 'node:assert/strict';
import {Mesh,Vector3} from '../lib/three.core.js';
import {handPlayPlacement,playSpaceConfig,applyHandPlayPlacement} from '../experiments/hand-play-space.mjs';
import {mlsConfig} from '../mls-juice-contract.mjs';
import {createMlsGoinPile} from '../mls-goin-pile.mjs';
import {resolveMlsHandRequest,validateMlsHandRequest,validateMlsGoinRequest} from '../tools/mls-witness-source.mjs';
import {nativeFingerPacket} from '../experiments/hand-live-fluid.mjs';

// Local mapping policy fixture. Browser contract conformance is separately replayed.
const source={captureId:'mapping-fixture',pixelBasis:'unmirrored_camera',cropBox:[100,80,300,280],cropUV:Array(42).fill(.5),meshJointsMeters:[[.02,.03,.04]]};
const config=playSpaceConfig(),size={width:640,height:480};
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
assert(up.z<-.9&&up.y>0,'upright fingers should aim into the world, not require foreshortening');
assert.equal(mesh.scale.x,-5,'translation and articulation must share mirror parity');
const joints=[source.meshJointsMeters[0],...Array.from({length:20},(_,i)=>[.02,.03-(i%4+1)*.02,.04])];
const packet=nativeFingerPacket({...source,meshJointsMeters:joints,source:'mobrecon_densestack_spiralconv',jointBasis:'upstream_j_reg_mano_to_mpii',captureEpochMs:100},
  {nowMs:100,running:true,center:a.center,matrix:mesh.matrixWorld});
assert(packet.emitters.every(e=>e.active),'placement must preserve extension');
const meshTip=new Vector3(0,.08,0).applyMatrix4(mesh.matrixWorld);
assert(meshTip.distanceTo(new Vector3(...packet.emitters[0].origin_world))<1e-10,'jet must leave the displayed fingertip');
assert(new Vector3(...packet.emitters[0].aim_world).distanceTo(up)<1e-10,'jet must follow the displayed finger');
assert.throws(()=>handPlayPlacement({...source,cropUV:[]},size,config),/observation/);
assert.throws(()=>handPlayPlacement({...source,pixelBasis:'mirrored'},size,config),/pixel basis/);
assert.throws(()=>playSpaceConfig({depth:NaN}),/play space/);
assert.equal(handPlayPlacement({...source,acquisitionDetails:{fallback:true}},size,config).fallback,true);

const centers=[[-1.8,-1.3],[-.6,-2.1],[.6,-2.1],[1.8,-1.3]];
const pile=createMlsGoinPile(mlsConfig({gridSize:[192,80,256],goinPile:{count:24,stackCenters:centers}}));
assert.deepEqual(pile.read().bodies.slice(0,4).map(b=>[b.position[0],b.position[2]]),centers,'authored broad layout was ignored');
pile.dispose();
assert.throws(()=>mlsConfig({goinPile:{stackCenters:[]}}),/stack centers/);
assert.throws(()=>mlsConfig({goinPile:{stackCenters:[[0,NaN]]}}),/stack centers/);
assert.equal(resolveMlsHandRequest('hand-play-space',{}).playSpace.pitchDegrees,65,'witness must resolve the actual route');
assert.deepEqual(resolveMlsHandRequest('hand-play-space',{goinPile:{mass:.5}}).goinPile.stackCenters,centers,'mass edit must retain the court layout');
assert.throws(()=>validateMlsHandRequest({playSpace:null},{playSpace:{}}),/config mismatch/);
assert.throws(()=>validateMlsHandRequest({playSpace:{config,observation:null}},{playSpace:{}}),/missing play space/);
assert.throws(()=>validateMlsHandRequest({captureId:'new',playSpace:{config,observation:a}},{playSpace:{}}),/stale play space/);
const layoutPile=createMlsGoinPile(mlsConfig({goinPile:{count:4,stackCenters:centers}}));
const effective=layoutPile.read();layoutPile.dispose();
validateMlsGoinRequest(effective,{count:4,stackCenters:centers});
assert.throws(()=>validateMlsGoinRequest({...effective,stackCenters:null},{count:4,stackCenters:centers}),/layout mismatch/);
console.log('Camera-plane mapping, coherent tilt/mirror, stable wrist anchor and broad goin layout');
