import assert from 'node:assert/strict';
import * as e from '../scratch/beaming-surface-evidence.mjs';
assert.equal(typeof e.assertScatteringView,'function','scattering comparison needs actual route and source identities');
const good={lighting:{previewStale:false,surfaceGain:1,surfaceScattering:true,frame:{surfaceScattering:{enabled:true,sourceGeneration:1},frame:0,generation:1,surfaceReceivers:1,directions:12,angularPattern:'source',gain:1,sourceSoftness:0,surfaceReconstruction:{passes:0}}},volume:{error:null,physicalColor:{material:{scatteringAlbedo:.5}}},source:{generation:1,frame:0,dimensions:[1,1,1],values:[2,1,1,.5]},scattering:{generation:1,frame:0,dimensions:[1,1,1],values:[.25]},surface:[1,1,1,1],back:[0,0,0,1],smoke:[1,1,1,1],dimensions:{surface:[1,1,1],back:[1,1,1],smoke:[1,1,1]}};
const check=s=>e.assertScatteringView(s,{count:12,albedo:.5,enabled:true,trim:0,master:0});check(good);
const fractional=structuredClone(good);fractional.volume.physicalColor.material.scatteringAlbedo=Math.fround(.8);
e.assertScatteringView(fractional,{count:12,albedo:.8,enabled:true,trim:0,master:0});
for(const change of [s=>s.scattering.generation=0,s=>s.scattering.values=[],s=>s.surface=[1],s=>s.lighting.surfaceScattering=false,s=>s.lighting.frame.surfaceScattering.enabled=false,s=>s.lighting.frame.directions=24,s=>s.lighting.frame.gain=2,s=>s.lighting.surfaceGain=2,s=>s.surface[0]=NaN,s=>s.volume.physicalColor.material.scatteringAlbedo=0]){const bad=structuredClone(good);change(bad);assert.throws(()=>check(bad));}
console.log('scatter witness rejects partial, stale, wrong-route and wrong-control evidence');
