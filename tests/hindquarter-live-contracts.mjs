// kaminos-test: node
import assert from 'node:assert/strict';
import {skinTransport,validateLiveManifest} from '../hindquarter-live-core.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const pivot=[0,1,0,0,-1,0,0,0,0,0,1,0,1,-1,0,1];
assert.deepEqual(Array.from(skinTransport(new Float32Array([2,0,0]),new Float32Array([0,1]),[identity,pivot])),[1,1,0]);
const fixed=skinTransport(new Float32Array([2,0,0]),new Float32Array([1,0]),[identity,pivot]);
assert.deepEqual(Array.from(fixed),[2,0,0]);
assert.throws(()=>skinTransport(new Float32Array([2,0,0]),new Float32Array([.2,.2]),[identity,pivot]),/partition/);
const scaled=identity.slice();scaled[0]=2;
assert.throws(()=>skinTransport(new Float32Array([2,0,0]),new Float32Array([0,1]),[identity,scaled]),/scaling/);
assert.throws(()=>skinTransport(new Float32Array([NaN,0,0]),new Float32Array([1,0]),[identity,pivot]),/rest geometry/);
const channels=['fixed','pelvis',...['left','right'].flatMap(side=>['hip','stifle','hock'].map(j=>`hindlimb-${side}-${j}`))];
const assets={};
for(const [name,shape,dtype]of [['rest.bin',[50501,3],'<f4'],['triangles.bin',[86392,3],'<u4'],
  ['automatic-weights.bin',[50501,8],'<f4'],['painted-weights.bin',[50501,8],'<f4'],
  ['blender-reference.bin',[10,50501,3],'<f4'],['automatic-presets.bin',[10,50501,3],'<f4']])assets[name]={shape,dtype,bytes:shape.reduce((a,b)=>a*b,4),sha256:'b'.repeat(64)};
const good={schema:'kaminos.live-transport.v1',status:'completed',sourceSha256:'a'.repeat(64),sourceCast:'CAT_CAST_MANNEQUIN_80413_STRONG',candidatePaintedWeights:false,
  vertices:50501,triangles:86392,channels,bones:channels.slice(1).map(name=>({name,parent:name==='pelvis'?null:'pelvis'})),assets,presets:Array.from({length:10},(_,i)=>({name:String(i)}))};
validateLiveManifest(good);
assert.throws(()=>validateLiveManifest({...good,sourceCast:'wrong cast'}),/source cast/);
assert.throws(()=>validateLiveManifest({...good,assets:{...assets,'automatic-presets.bin':{...assets['automatic-presets.bin'],bytes:0}}}),/asset/);
assert.throws(()=>validateLiveManifest({...good,status:'running'}),/incomplete/);
assert.throws(()=>validateLiveManifest({...good,candidatePaintedWeights:true}),/incomplete/);
console.log('Live transport numeric and negative contracts pass');
