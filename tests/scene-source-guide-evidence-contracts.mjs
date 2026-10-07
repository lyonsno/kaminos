import assert from 'node:assert/strict';
import * as evidence from '../scratch/beaming-surface-evidence.mjs';
assert.equal(typeof evidence.assertSourceGuideEvidence,'function','native guide evidence must reject requested/effective substitution and blank output');
const signal={runtime:{source:{repoRoot:'/r',commit:'abc',dirty:false}},source:{root:'/r',revision:'abc',dirty:''},adapter:{vendor:'apple',architecture:'metal-3',isFallbackAdapter:false},lighting:{frame:{angularPattern:'guided',generation:3,directions:12,surfaceReceivers:1,allocatedVolumeReceivers:2,transportVolumeReceivers:2,sourceGuide:{lo:[-.38,-1,-.38],hi:[.38,1.44,.38]},samplingLaw:'emitter-envelope-mixture-solid-angle-v1',surfaceScattering:{enabled:true},receiverSampling:{spacing:0}},gain:2,surfaceGain:1},sourceGeneration:3,sourceMetadata:{dimensions:[1,2,1],channels:4,generation:3},dimensions:{front:[1,1,1],back:[1,1,1],smoke:[1,2,1]},primary:[1,0,0,0,0,0,0,0],front:[1,0,0,1],back:[0,0,0,1],smoke:[1,0,0,1,0,0,0,1],errors:[],httpFailures:[]};
const request={pattern:'guided',count:12,gain:2,spacing:0};
evidence.assertSourceGuideEvidence(signal,request);
const paddingOnly=structuredClone(signal);paddingOnly.dimensions.front=[2,1,1];paddingOnly.dimensions.back=[2,1,1];paddingOnly.front=[0,0,0,1,1,0,0,0];paddingOnly.back=[0,0,0,1,0,0,0,0];
assert.throws(()=>evidence.assertSourceGuideEvidence(paddingOnly,request),'unused padding cannot establish a luminous active surface');
const finalRow=structuredClone(signal);finalRow.dimensions.front=[2,2,1];finalRow.dimensions.back=[2,2,1];finalRow.lighting.frame.surfaceReceivers=3;finalRow.front=[0,0,0,1,0,0,0,1,1,0,0,1,0,0,0,0];finalRow.back=[0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0];
evidence.assertSourceGuideEvidence(finalRow,request);
for(const mutate of [s=>s.primary=s.primary.slice(0,4),s=>s.dimensions.front=[2,1,1],s=>s.lighting.frame.surfaceReceivers=2,s=>delete s.smoke,s=>s.smoke[0]=NaN,s=>s.smoke=s.smoke.slice(0,4),s=>s.lighting.frame.allocatedVolumeReceivers=1,s=>delete s.sourceMetadata.dimensions,s=>s.dimensions.smoke=[1,1,1],s=>s.front[3]=0,s=>s.smoke[7]=0]){
 const s=structuredClone(signal);mutate(s);assert.throws(()=>evidence.assertSourceGuideEvidence(s,request),'partial/count-inconsistent/unwritten source or smoke field must fail');
}
const unknownAdapter=structuredClone(signal);delete unknownAdapter.adapter.isFallbackAdapter;assert.throws(()=>evidence.assertSourceGuideEvidence(unknownAdapter,request),'missing fallback identity cannot establish native evidence');
for(const mutate of [s=>s.runtime.source.repoRoot='/wrong',s=>s.runtime.source.dirty=true,s=>s.adapter.vendor='software',s=>s.lighting.frame.angularPattern='source',s=>s.lighting.frame.directions=24,s=>s.sourceGeneration=2,s=>s.front=[],s=>s.front[0]=NaN,s=>s.front=[0,0,0,0],s=>s.lighting.frame.sourceGuide=null,s=>s.lighting.gain=1,s=>s.errors.push('validation error')]){const s=structuredClone(signal);mutate(s);assert.throws(()=>evidence.assertSourceGuideEvidence(s,request),'unverified output must not become guided evidence');}
console.log('guide evidence rejects wrong route/config, missing/stale/blank/nonfinite output');
