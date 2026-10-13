// kaminos-test: node
import assert from 'node:assert/strict';
import {validateHindquarterState} from '../hindquarter-binding-witness.mjs';
const expected={manifest:'a'.repeat(64),source:'b'.repeat(64)};
const state={schema:'kaminos.hindquarter-binding-browser.v1',status:'loaded',effectiveRoute:'dedicated-kaminos-independent-cast-replay',rendererBackend:'WebGPUBackend',expectedManifestSha256:expected.manifest,effectiveManifestSha256:expected.manifest,sourceSha256:expected.source,sourceCast:'CAT_CAST_MANNEQUIN_80413_STRONG',candidatePaintedWeights:false,vertices:50501,frames:39,frame:0,metrics:{fieldErrorMean:0},modes:['support-bound','automatic-transport','painted-reference'].map((mode,i)=>({mode,id:String(i),vertices:50501}))};
validateHindquarterState(state,expected);
for(const change of [{status:'loading'},{rendererBackend:'WebGLBackend'},{effectiveManifestSha256:'c'.repeat(64)},{sourceSha256:'d'.repeat(64)},{candidatePaintedWeights:true},{vertices:1000},{frames:13},{metrics:{}},{modes:state.modes.map(row=>({...row,mode:'support-bound'}))}])assert.throws(()=>validateHindquarterState({...state,...change},expected));
console.log('hindquarter witness rejects wrong case/source, fallback, painted candidate, partial mesh/motion and missing diagnostics');
