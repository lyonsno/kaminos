import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateVisibilitySample,runVisibilityComparison} from '../scratch/beaming-bounded-comparison.mjs';
const expected={mode:'source-volume',generation:129,preparations:2};
const base={metadata:{visibilityBounds:'source-volume',generation:129,directions:8,angularPattern:'guided',angularCache:{counts:[8],visibilityPreparations:2}},before:{encodes:1,pipelines:4,rayBuffers:1},after:{encodes:2,pipelines:4,rayBuffers:1},profile:{errors:[],records:[{valid:true,totalMs:1,rawNanoseconds:['100','1000100'],passes:[{label:'static kiln visibility preparation',ms:1}]}]}};
assert.equal(validateVisibilitySample(base,expected),true);
for(const alter of [
 s=>s.metadata.visibilityBounds='unbounded',s=>s.metadata.generation=128,
 s=>s.metadata.angularCache.counts=[96],s=>s.metadata.angularCache.visibilityPreparations=1,
 s=>s.after.encodes=3,s=>s.after.rayBuffers=2,s=>s.after.pipelines++,s=>s.profile.records=[],
 s=>s.profile.records[0].passes=[],s=>s.profile.errors=['device lost'],
 s=>s.profile.records[0].totalMs=NaN,
]){const sample=structuredClone(base);alter(sample);assert.throws(()=>validateVisibilitySample(sample,expected));}
const invalid=structuredClone(base);invalid.profile.records[0]={valid:false,totalMs:null,rawNanoseconds:['200','100'],passes:[{label:'static kiln visibility preparation',ms:null}]};invalid.profile.errors=['missing/nonmonotonic lighting timestamps'];
assert.equal(validateVisibilitySample(invalid,expected),false,'invalid sample retained but never admitted as time');
invalid.profile.records[0].passes[0].ms=1;assert.throws(()=>validateVisibilitySample(invalid,expected));
// Exercise the actual comparison loop: an inadmissible arm must still retain
// the raw field already obtained from the GPU, with its rejected route identity.
const out=await mkdtemp(path.join(os.tmpdir(),'kaminos-rejected-visibility-'));
const rejected=structuredClone(base);rejected.metadata.visibilityBounds='wrong-route';
const raw=new Float32Array([.25,2,3,1]);
rejected.fields={surface:{dimensions:[1,1],data:Array.from(raw)}};
const report={};
const page={async evaluate(fn,args){return args?.readFields?structuredClone(rejected):undefined;}};
await assert.rejects(runVisibilityComparison({page,out,report,save:async()=>{},iterations:1,broken:new Promise(()=>{}),capture:{sourceGeneration:129,lighting:{frame:{angularCache:{visibilityPreparations:1}}}}}),/requested visibility route must be effective/);
assert.equal(report.pairs[0].arms[0].metadata.visibilityBounds,'wrong-route');
assert.deepEqual(await readFile(path.join(out,'pair-0-unbounded-surface.f32')),Buffer.from(raw.buffer),'validation failure must preserve captured field bytes');
console.log('rejected-arm raw evidence retained at '+out);
console.log('fallback, stale source/cache, hidden capacity, interleaving, missing and invalid evidence rejected');
