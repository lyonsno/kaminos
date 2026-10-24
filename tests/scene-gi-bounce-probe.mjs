// kaminos-test: node
import assert from 'node:assert/strict';
import {validateProbeSource} from '../scene-gi-bounce-probe.mjs';
const source={backend:'WebGPUBackend',mode:'combined',feedback:false,valid:true,sourceComparison:false,
  width:360,height:480,historyWidth:360,historyHeight:480,firstBounceSamples:128,samples:128};
assert.equal(validateProbeSource(source),source);
for(const [patch,message] of [
  [{backend:'WebGLBackend'},/WebGPU/],
  [{mode:'off'},/combined/],
  [{feedback:true},/first bounce/],
  [{valid:false},/valid history/],
  [{firstBounceSamples:0},/stationary/],
  [{sourceComparison:true},/detailed source/],
  [{historyWidth:1},/extent/],
  [{samples:0},/sample count/],
  [{samples:1.5},/sample count/],
])assert.throws(()=>validateProbeSource({...source,...patch}),message);
console.log('Frozen bounce probe refuses fallback, stale or contaminated inputs');
