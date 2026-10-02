import assert from 'node:assert/strict';
import {assertSofteningView} from '../scratch/beaming-softening-evidence.mjs';
const source='a'.repeat(64),baseline='b'.repeat(64),changed='c'.repeat(64);
const options={passes:4,gain:4,sourceHash:source,baselineSource:source,surfaceHash:changed,baselineSurface:baseline,thin:true};
const view={volume:{error:null,controls:{density:.35,physicalSmokeExtinction:.1}},lighting:{identity:'distributed-volume-direct-radiance-v0',directions:24,gain:4,sourceSoftness:4,smokeMode:'distributed',frame:{directions:24,gain:4,sourceSoftness:4,volumeReceivers:8192,surfaceReceivers:10,generation:2,sourceSoftening:{identity:'solid-bounded-emission-diffusion-v1',passes:4,staticPreparations:1,updates:2,dimensions:[32,64,32],extinction:'unchanged',rawSourceMutated:false}}}};
assertSofteningView(view,options);
for(const mutate of [
  v=>v.volume.error='device lost',v=>v.lighting.identity='fallback',v=>v.lighting.frame.directions=96,
  v=>v.lighting.frame.sourceSoftness=0,v=>v.lighting.frame.gain=1,v=>v.lighting.smokeMode='legacy',
  v=>v.lighting.frame.volumeReceivers=0,v=>v.lighting.frame.surfaceReceivers=0,v=>v.lighting.frame.generation=0,
  v=>v.lighting.frame.sourceSoftening=null,v=>v.lighting.frame.sourceSoftening.updates=0,
  v=>v.lighting.frame.sourceSoftening.passes=1,v=>v.lighting.frame.sourceSoftening.rawSourceMutated=true,
  v=>v.volume.controls.physicalSmokeExtinction=8,
]){const altered=structuredClone(view);mutate(altered);assert.throws(()=>assertSofteningView(altered,options));}
for(const override of [{sourceHash:'d'.repeat(64)},{surfaceHash:baseline},{surfaceHash:''}])assert.throws(()=>assertSofteningView(view,{...options,...override}));
console.log('softening witness rejects wrong route, shadowed controls, missing work and source/receiver substitution');
