import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as evidence from '../structural-material-shard-release-evidence.mjs';
const [file]=process.argv.slice(2);if(!file)throw new Error('Observed failed native report required');
const r=JSON.parse(fs.readFileSync(file)),w=r.failureState.witness,finish=w.inputs.findIndex(i=>i.kind==='gesture-finish-request'),probeIndex=finish-1,expected={generation:w.inputs[finish].data.generation,displacement:w.inputs[probeIndex-1].data.displacement};
assert.deepEqual(w.inputs[probeIndex].data.displacement,[.01,0,0],'Fixture must retain the observed pre-handler probe, not an unrelated failure');
let calls=0;const prefix={...w,inputs:w.inputs.slice(0,probeIndex),gesture:{generation:expected.generation,inputClosed:false,displacement:expected.displacement}},api={witness:()=>prefix,move(){calls++;}};
if(evidence.probeAdmittedRelease){const result=evidence.probeAdmittedRelease(api,expected);assert.equal(result.closed,false);assert.equal(result.moveRejected,null);}else{
 const text=fs.readFileSync(new URL('../structural-material-shard-release-smoke.mjs',import.meta.url),'utf8'),start=text.indexOf('await page.addInitScript('),end=text.indexOf('\n const cdp',start),handlers=new Map(),window={__stoneShards:api,addEventListener:(type,fn)=>handlers.set(type,fn)};
 vm.runInNewContext(text.slice(start,end).replace(/^await /,''),{page:{addInitScript(fn){fn();}},window,queueMicrotask:fn=>fn(),performance:{now:()=>3815.7},Map});
 // Re-run the recorded early checkpoint using the actual old callback, not a browser-conformance claim.
 handlers.get('pointerup')({buttons:0,button:0,pointerId:1,clientX:1,clientY:1});
}
assert.equal(calls,0,'An unadmitted boundary must never author a probe force');
if(evidence.probeAdmittedRelease){
 const boundary={kind:'gesture-finish-request',data:{generation:expected.generation,finalDisplacement:[...expected.displacement]}};
 const admitted={...prefix,inputs:[...prefix.inputs,boundary],gesture:{...prefix.gesture,inputClosed:true}};const closedApi={witness:()=>admitted,move(){throw new Error('Picked patch input is closed');}};
 const seen=evidence.probeAdmittedRelease(closedApi,expected);assert.equal(seen.closed,true);assert.equal(seen.moveRejected,true);assert.equal(seen.finalVectorPreserved,true);
 const stale=evidence.probeAdmittedRelease(closedApi,{...expected,generation:expected.generation+1});assert.equal(stale.closed,false);assert.equal(stale.moveRejected,null);
}
console.log('Observed pre-handler prefix cannot trigger a force-authoring probe; synthetic prefix replay does not establish native event timing');
