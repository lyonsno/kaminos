import assert from 'node:assert/strict';
import { inspectGpuArchLoad } from '../structural-material-arch-gpu-evidence.mjs';
const identity={backend:'webgpu',adapterFallback:false,isFallbackAdapter:false,engineRevision:'96b043c88dc2a4af5367820caf1e1e9f458d5560',enginePatch:'kaminos-fixed-joint-rest-relative-v1'};
const valid={phase:'interactive',route:'kaminos.structural-material.arch-gravity-collapse.webgpu-avbd.v0',identity,failures:[],
 state:{backend:'webgpu-avbd',config:{layers:3,strength:80,timeStep:1/60,gripRadius:.55},step:1,
 bodies:[{index:0,pinned:true,mass:0,position:{x:0,y:0,z:0},quaternion:{x:0,y:0,z:0,w:1},velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}],bonds:[],broken:0,
 residency:{bodyPose:'gpu-authoritative',connectivity:'gpu-authoritative',collision:'gpu-avbd',allPairsCapacity:1,allPairsRequired:1,stats:{pairDispatchTruncated:false}}},rendererPoses:[{index:0,position:[0,0,0],quaternion:[0,0,0,1]}]};
for(const patch of [{identity:null},{phase:'failed'},{route:'cpu-reference'},{failures:[{operation:'GPU validation'}]},
 {identity:{...identity,backend:'webgl'}},{identity:{...identity,isFallbackAdapter:null}},{identity:{...identity,adapterFallback:true}},{identity:{...identity,enginePatch:'old'}},
 {state:{...valid.state,config:{...valid.state.config,strength:30}}},{state:{...valid.state,bodies:[]}},{state:{...valid.state,residency:{...valid.state.residency,allPairsCapacity:0}}},
 {state:{...valid.state,residency:{...valid.state.residency,stats:{pairDispatchTruncated:true}}}},
 {rendererPoses:[{index:0,position:[0,1,0],quaternion:[0,0,0,1]}]}])assert.ok(inspectGpuArchLoad({...valid,...patch}).length,`must reject ${JSON.stringify(patch)}`);
assert.deepEqual(inspectGpuArchLoad({...valid,unknownAdditiveField:true}),[]);
console.log('GPU arch state rejects wrong route/config, stale patch, incomplete contacts and mismatched display poses');
