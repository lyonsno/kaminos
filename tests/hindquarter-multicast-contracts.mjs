// kaminos-test: node
import assert from 'node:assert/strict';
import {validateLiveManifest} from '../hindquarter-live-core.mjs';
import {validateLiveState} from '../hindquarter-live-witness.mjs';
const channels=['fixed','pelvis',...['left','right'].flatMap(side=>['hip','stifle','hock'].map(j=>`hindlimb-${side}-${j}`))];
const assets={};
for(const [name,shape,dtype]of [['rest.bin',[12569,3],'<f4'],['triangles.bin',[19992,3],'<u4'],
  ['automatic-weights.bin',[12569,8],'<f4'],['automatic-presets.bin',[10,12569,3],'<f4']]){
  assets[name]={shape,dtype,bytes:shape.reduce((a,b)=>a*b,4),sha256:'b'.repeat(64)};
}
const specimen={schema:'kaminos.live-transport.v2',status:'completed',sourceSha256:'a'.repeat(64),sourceCast:'sf3d-skin-baseline',
  candidatePaintedWeights:false,vertices:12569,triangles:19992,channels,
  bones:channels.slice(1).map(name=>({name,parent:name==='pelvis'?null:'pelvis'})),assets,
  presets:Array.from({length:10},(_,i)=>({name:String(i)})),reference:{kind:'none',reason:'No painted reference exists for this cast'},
  provenance:{packageSha256:'c'.repeat(64),rigSourceSha256:'d'.repeat(64),frameChainSha256:'e'.repeat(64)}};
assert.equal(validateLiveManifest(specimen),specimen,'A full different cast without a fabricated painted reference must load');
assert.throws(()=>validateLiveManifest({...specimen,vertices:0}),/source cast/);
assert.throws(()=>validateLiveManifest({...specimen,reference:{kind:'painted'}}),/reference/);
assert.throws(()=>validateLiveManifest({...specimen,assets:{...assets,'painted-weights.bin':assets['automatic-weights.bin']}}),/reference/);
assert.throws(()=>validateLiveManifest({...specimen,provenance:{...specimen.provenance,frameChainSha256:null}}),/provenance/);
assert.throws(()=>validateLiveManifest({...specimen,assets:{...assets,'automatic-presets.bin':{...assets['automatic-presets.bin'],bytes:0}}}),/asset/);
console.log('Distinct full casts, absent reference and frame provenance contracts pass');
const expected={manifest:'a'.repeat(64),source:'b'.repeat(64),vertices:12569,triangles:19992,referenceAvailable:false};
const state={status:'loaded',schema:'kaminos.live-transport-browser.v1',rendererBackend:'WebGPUBackend',effectiveRoute:'index-scene-live-rear-transport',
  requestedSha256:expected.manifest,effectiveSha256:expected.manifest,sourceSha256:expected.source,candidatePaintedWeights:false,
  vertices:12569,triangles:19992,referenceAvailable:false,registeredIds:Array.from({length:7},(_,i)=>String(i)),
  controls:Array.from({length:6},(_,i)=>({uuid:String(i),name:'bone'+i}))};
validateLiveState(state,expected);
assert.throws(()=>validateLiveState({...state,vertices:50501},expected),/partial cast/);
assert.throws(()=>validateLiveState({...state,referenceAvailable:true},expected),/reference/);
