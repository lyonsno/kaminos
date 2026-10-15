import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const target=new URL('../tools/sam31-tracker-memory-benchmark-evidence.mjs',import.meta.url);
assert(fs.existsSync(target),'native tracker benchmark must admit effective mode, source, geometry and complete outputs');
const {validateSam31TrackerMemoryBenchmarkRun,compareSam31TrackerMemoryOutputs}=await import(target.href);
const expected={mode:'online',commit:'source:current',modelPackageId:'model:fixed',queryTokens:4,memoryTokens:20,
  imageHeight:28,imageWidth:28,queryHeight:2,queryWidth:2,maskHeight:8,maskWidth:8,channels:256,multiplexCount:16};
const outputs={conditionedFeatures:new Float32Array(1024).fill(1),selectedMasks:new Float32Array(1024).fill(-1),
  objectScores:new Float32Array(16),objectPointers:new Float32Array(4096)};
const attentionStages=Array.from({length:4},(_,i)=>['Self','Cross'].map(kind=>({name:`layer${i}${kind}Attention`,metadata:{kernelName:`layer${i}${kind}Attention`},ms:2}))).flat();
const digest=array=>'sha256:'+createHash('sha256').update(Buffer.from(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
const roles={conditionedFeatures:'sam31-memory-conditioned-features',selectedMasks:'sam31-multiplex-selected-masks',objectScores:'sam31-multiplex-object-scores',objectPointers:'sam31-multiplex-object-pointers'};
function make(){const routes=Array.from({length:19},(_,i)=>`route:${i}`);routes[17]='sam3.1.memory-attention.phase-program.webgpu-local.v0';return {
  memoryAttentionKernel:'online',adapterInfo:{isFallbackAdapter:false,vendor:'apple',architecture:'metal-3'},evidence:{passed:true},
  manifest:{executionGeometry:{imageHeight:28,imageWidth:28,queryHeight:2,queryWidth:2,queryTokens:4,memoryTokens:20,decoderMaskHeight:8,decoderMaskWidth:8}},
  packageRuntime:{packageId:'model:fixed',sourceImageSha256:['image:0','image:1'],initialMaskSha256:'mask:0'},
  requestedRouteIds:routes,effectiveRouteIds:routes,receipts:routes.map((id,i)=>({requestedRouteId:id,effectiveRouteId:id,status:'real',fallbackReason:null,
    kernel:{commit:'source:current'},outputs:i===17?[{role:roles.conditionedFeatures,status:'real',sha256:digest(outputs.conditionedFeatures)}]:i===18?Object.entries(outputs).filter(([key])=>key!=='conditionedFeatures').map(([key,array])=>({role:roles[key],status:'real',sha256:digest(array)})):[{status:'real',sha256:'output:actual'}],timings:{stages:id.includes('memory-attention')?attentionStages:[]}})),
  residentRuntime:{residentSessionId:'session:one',modelPackageId:'model:fixed',resourceCount:1007,liveBufferIds:Array.from({length:1007},(_,i)=>`buffer:${i}`),modelAllocationDelta:0,modelUploadDelta:0,truncated:false},
  timing:{kind:'host-wall',episodeWallMs:100,frame1:{backboneMs:30,temporalBankMs:10,memoryAttentionMs:20,decoderMs:10,attributedTotalMs:70,memoryAttentionShare:20/70}},
};}
assert.doesNotThrow(()=>validateSam31TrackerMemoryBenchmarkRun(make(),outputs,expected));
const repeated=make();
repeated.requestedRouteIds[1]=repeated.requestedRouteIds[0];
repeated.effectiveRouteIds[1]=repeated.requestedRouteIds[0];
repeated.receipts[1]={...repeated.receipts[0]};
assert.doesNotThrow(()=>validateSam31TrackerMemoryBenchmarkRun(repeated,outputs,expected));
for(const [name,mutate] of [
  ['fallback',r=>r.adapterInfo.isFallbackAdapter=true],['wrong mode',r=>r.memoryAttentionKernel='flash'],
  ['wrong source',r=>r.receipts[0].kernel.commit='stale'],['partial routes',r=>r.receipts.pop()],
  ['small geometry',r=>r.manifest.executionGeometry.queryTokens=1],['wrong model',r=>r.packageRuntime.packageId='model:other'],
  ['missing stages',r=>r.receipts[17].timings.stages=[]],['wrong effective kernel',r=>r.receipts[17].timings.stages=attentionStages.map(x=>({...x,metadata:{kernelName:x.metadata.kernelName+'Flash0'}}))],
  ['model upload',r=>r.residentRuntime.modelUploadDelta=1],['missing input identity',r=>r.packageRuntime.initialMaskSha256=null],
  ['timing inconsistent',r=>r.timing.frame1.attributedTotalMs=1],['missing output hash',r=>r.receipts[18].outputs[0].sha256=null],
]){const r=make();mutate(r);assert.throws(()=>validateSam31TrackerMemoryBenchmarkRun(r,outputs,expected),undefined,name);}
for(const [name,changed] of [['missing output',{...outputs,selectedMasks:undefined}],['partial output',{...outputs,conditionedFeatures:new Float32Array(1)}],
  ['nonfinite output',{...outputs,objectScores:Float32Array.from({length:16},()=>NaN)}],['blank features',{...outputs,conditionedFeatures:new Float32Array(1024)}]]){
  assert.throws(()=>validateSam31TrackerMemoryBenchmarkRun(make(),changed,expected),undefined,name);
}
const substituted={...outputs,selectedMasks:new Float32Array(1024).fill(1)};
assert.throws(()=>validateSam31TrackerMemoryBenchmarkRun(make(),substituted,expected),undefined,'same-length output substitution must disagree with actual readback receipt');
assert.equal(typeof compareSam31TrackerMemoryOutputs,'function','benchmark must compare complete preserved arrays');
const compared=compareSam31TrackerMemoryOutputs(new Float32Array([1,-2]),new Float32Array([1,4]));
assert.equal(compared.elementCount,2);
assert.equal(compared.maxAbsDiff,6);
assert.equal(compared.meanAbsDiff,3);
assert.equal(compared.rootMeanSquareDiff,Math.sqrt(18));
assert.equal(compared.relativeL2Diff,Math.sqrt(36/5));
assert.equal(compared.binaryMismatchCount,1);
assert.equal(compared.differentElementCount,1);
assert.throws(()=>compareSam31TrackerMemoryOutputs(new Float32Array(2),new Float32Array(1)),/length/);
assert.throws(()=>compareSam31TrackerMemoryOutputs(new Float32Array([NaN]),new Float32Array([0])),/finite/);
assert.equal(compareSam31TrackerMemoryOutputs(new Float32Array([0]),new Float32Array([1])).relativeL2Diff,null);
console.log('SAM3.1 tracker native memory benchmark admission contracts passed');
