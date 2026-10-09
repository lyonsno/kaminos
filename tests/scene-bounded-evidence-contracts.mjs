import assert from 'node:assert/strict';
import {validateVisibilitySample} from '../scratch/beaming-bounded-comparison.mjs';
const expected={mode:'source-volume',generation:129,preparations:2};
const base={metadata:{visibilityBounds:'source-volume',generation:129,directions:8,angularPattern:'guided',angularCache:{counts:[8],visibilityPreparations:2}},before:{encodes:1,pipelines:4,rayBuffers:1},after:{encodes:2,pipelines:4,rayBuffers:1},profile:{errors:[],records:[{valid:true,totalMs:1,rawNanoseconds:['100','1000100'],passes:[{label:'static kiln visibility preparation',ms:1}]}]}};
assert.equal(validateVisibilitySample(base,expected),true);
for(const alter of [
 s=>s.metadata.visibilityBounds='unbounded',s=>s.metadata.generation=128,
 s=>s.metadata.angularCache.counts=[96],s=>s.metadata.angularCache.visibilityPreparations=1,
 s=>s.after.encodes=3,s=>s.after.rayBuffers=2,s=>s.profile.records=[],
 s=>s.profile.records[0].passes=[],s=>s.profile.errors=['device lost'],
 s=>s.profile.records[0].totalMs=NaN,
]){const sample=structuredClone(base);alter(sample);assert.throws(()=>validateVisibilitySample(sample,expected));}
const invalid=structuredClone(base);invalid.profile.records[0]={valid:false,totalMs:null,rawNanoseconds:['200','100'],passes:[{label:'static kiln visibility preparation',ms:null}]};invalid.profile.errors=['missing/nonmonotonic lighting timestamps'];
assert.equal(validateVisibilitySample(invalid,expected),false,'invalid sample retained but never admitted as time');
invalid.profile.records[0].passes[0].ms=1;assert.throws(()=>validateVisibilitySample(invalid,expected));
console.log('fallback, stale source/cache, hidden capacity, interleaving, missing and invalid evidence rejected');
