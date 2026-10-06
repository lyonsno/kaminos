import assert from 'node:assert/strict';
import * as evidence from '../scratch/beaming-surface-evidence.mjs';
assert.equal(typeof evidence.assertSourceMotionView,'function','motion comparison needs effective-route and held-source checks');
const good={volume:{error:null},lighting:{previewStale:false,geometryBuilds:1,frame:{frame:1,directions:12,angularPattern:'source',integration:'exact-cell',generation:1,sourceSoftness:0,surfaceReconstruction:{passes:0},surfaceReceivers:1}},source:{frame:1,generation:1,dimensions:[1,1,1],values:[1,2,3,4]},dimensions:{surface:[1,1,1],back:[1,1,1]},surface:[1,2,3,1],back:[0,0,0,1]};
const check=s=>evidence.assertSourceMotionView(s,{count:12,pattern:'source',heldSource:good.source.values});
check(good);
for(const key of ['frame','generation'])for(const sides of [['source'],['lighting'],['source','lighting']])for(const invalid of [undefined,null,'1',NaN,Infinity,-1,1.5]){
 const bad=structuredClone(good);for(const side of sides){const o=side==='source'?bad.source:bad.lighting.frame;if(invalid===undefined)delete o[key];else o[key]=invalid;}assert.throws(()=>check(bad),`reject invalid ${key} identity on ${sides}`);
}
assert.throws(()=>evidence.assertSourceMotionView({...good,environment:{intensity:1,exposure:1,rim:false}},{count:12,pattern:'source',heldSource:good.source.values,lightOnly:true}),'light-only comparison must reject environment fill');
for(const mutate of [
 s=>s.lighting.frame.angularPattern='fixed',
 s=>s.lighting.frame.integration='midpoint',
 s=>s.lighting.frame.directions=24,
 s=>s.lighting.previewStale=true,
 s=>s.lighting.frame.sourceSoftness=4,
 s=>s.source.values[0]=2,
 s=>s.surface[0]=NaN,
 s=>s.surface=[],
 s=>s.surface=[1],
 s=>s.lighting.frame.frame=0,
 s=>s.volume.error='device lost',
]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>check(bad));}
assert.equal(typeof evidence.assertLitSourceMotionResponse,'function');
const next=structuredClone(good);next.source.values[0]=2;next.surface[0]=2;
evidence.assertLitSourceMotionResponse([good,next]);
for(const sequence of [[good,good],[good,{...next,surface:good.surface}], [good,next].map(s=>({...s,surface:[0,0,0,1],back:[0,0,0,1]}))])assert.throws(()=>evidence.assertLitSourceMotionResponse(sequence));
console.log('motion evidence rejects wrong route, stale source, hidden smoothing and nonfinite/empty output');
