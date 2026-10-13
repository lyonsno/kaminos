// kaminos-test: node
import assert from 'node:assert/strict';
import {validateLiveState} from '../hindquarter-live-witness.mjs';
const expected={manifest:'a'.repeat(64),source:'b'.repeat(64)};
const state={status:'loaded',schema:'kaminos.live-transport-browser.v1',rendererBackend:'WebGPUBackend',effectiveRoute:'index-scene-live-rear-transport',
  requestedSha256:expected.manifest,effectiveSha256:expected.manifest,sourceSha256:expected.source,candidatePaintedWeights:false,vertices:50501,triangles:86392,
  registeredIds:Array.from({length:8},(_,i)=>String(i)),controls:Array.from({length:6},(_,i)=>({uuid:String(i),name:'bone'+i}))};
validateLiveState(state,expected);
for(const change of [{rendererBackend:'WebGLBackend'},{effectiveRoute:'recorded-replay'},{effectiveSha256:'c'.repeat(64)},{sourceSha256:'c'.repeat(64)},
  {candidatePaintedWeights:true},{vertices:3},{registeredIds:[]},{controls:[]}])assert.throws(()=>validateLiveState({...state,...change},expected));
console.log('Live witness negative route/source contracts pass');
