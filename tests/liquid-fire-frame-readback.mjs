// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../finger-fluid-bench-witness.mjs',import.meta.url),'utf8');
const a=source.indexOf('(window.__kaminosCaptureComposedFireSample = async'),b=source.indexOf('})()`);',a);
assert.ok(a>=0&&b>a);
const expression=source.slice(a,b+4);
const receipt={application:{raymarchApplied:true,compositionEffective:'raymarch-only-v0',fallbackReason:null}};
const frame=()=>({ok:true,effectiveRoute:'native-3d-compute-fluid-raymarch-v0',backend:'WebGPU: Apple M4 Max',simAdvanced:false,width:1,height:1,simStepCount:7,image:{width:1,height:1,rgba:[255,200,40,255]},volumePresentationReceipt:structuredClone(receipt)});
async function capture(value){
 let options,unpaused=false;
 const window={__kaminosVolumePrototype:{sampleFrame:async o=>{options=o;return value;},setCapturePaused:v=>{unpaused=!v;}}};
 const result=await new Function('window','return '+expression)(window);
 return {result,options,unpaused};
}
test('liquid contact witness reads the retained renderer at the held simulation step',async()=>{
 const {result,options,unpaused}=await capture(frame());
 assert.equal(options.advanceSim,false);assert.equal(options.includeRgba,true);assert.equal(result.simStepCount,7);assert.equal(result.composedFireBounds.pixelCount,1);assert.equal(unpaused,true);
});
test('liquid contact witness rejects failed, fallback and partial output',async()=>{
 const bad=[{...frame(),ok:false},{...frame(),effectiveRoute:'fallback'},{...frame(),simAdvanced:true},{...frame(),image:null},{...frame(),image:{width:1,height:1,rgba:[]}},{...frame(),volumePresentationReceipt:{application:{...receipt.application,raymarchApplied:false}}}];
 for(const value of bad)await assert.rejects(capture(value));
});
