import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {m,plan,parent,projectionFixture} from './slat-convolution-contracts.mjs';
import {compareSLatDecoderObservation,validateSLatConvolutionResult,SLAT_CONVOLUTION_ROUTE} from '../slat-decoder-witness-checks.js';
import {preserveSamplerWitnessFailure,recordSamplerCompletion} from '../sparse-sampler-witness-checks.js';
const file=new URL('../sparse-slat-convolution-witness.js',import.meta.url);
assert.ok(await fs.access(file).then(()=>true,()=>false),
  'The production convolution witness must retain every completed observation through a numeric mismatch.');
const source=await fs.readFile(file,'utf8'),body=source.replace(/^import .*;\n/gm,'').replace('export async function','async function'),
  hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const mode of ['numeric-mismatch','neighbor-mismatch','partial-output','profile-failure','fallback']){
  const manifest=structuredClone(m),arrays={input:new Float32Array(48),coordinates:new Int32Array(9),
    'weight.blocks.0.0.conv.weight':new Float32Array(16*27*16),'weight.blocks.0.0.conv.bias':new Float32Array(16),
    'expected.neighbors':new Int32Array(81).fill(-1),'expected.convolution':new Float32Array(48)};
  for(const [n,a] of Object.entries(arrays))Object.assign(manifest.tensors[n],{file:n+'.raw',sha256:hash(a)});
  const manifests={'manifest.json':manifest,'parent-manifest.json':parent,'projection-manifest.json':projectionFixture},
    encoded=Object.fromEntries(Object.entries(manifests).map(([n,v])=>[n,new TextEncoder().encode(JSON.stringify(v))]));
  manifest.parentReference.sha256=hash(encoded['parent-manifest.json']);manifest.projectionReference.sha256=hash(encoded['projection-manifest.json']);
  encoded['manifest.json']=new TextEncoder().encode(JSON.stringify(manifest));
  const saved={},disposed=[],stages=['decoder-hash-clear','decoder-hash-insert','decoder-neighbors','decoder-sparse-conv'];
  let started=false;
  const runtime={uploadTensor(t,a){t.data=a;},async readTensor(t){return t.data.buffer.slice(t.data.byteOffset,t.data.byteOffset+t.data.byteLength);},
    finishProfile(){if(mode==='profile-failure')throw Error('observed profile failure');return {profile:{stages:stages.map(name=>({name}))}};}},
    ops={metadataReadbackBytes:4,convolutionsExecuted:0,
      allocate(name,shape,dtype='f32'){return {name,shape,dtype,data:new (dtype==='i32'?Int32Array:Float32Array)(shape.reduce((a,b)=>a*b,1))};},
      upload(name,shape,data){return {...this.allocate(name,shape),data};},
      async neighbors(){const t=this.allocate('neighbors',[3,27],'i32');t.data.fill(-1);if(mode==='neighbor-mismatch')t.data[0]=2;return t;},
      async conv(input,neighbors,weight,bias,out){started=true;this.convolutionsExecuted++;if(mode==='numeric-mismatch')out.data[0]=1;
        if(mode==='partial-output')out.data=new Float32Array(1);},async settle(){},dispose(){disposed.push('ops');}},
    device={pushErrorScope(){},addEventListener(){},async popErrorScope(){return null;},destroy(){disposed.push('device');}},
    adapter={info:{vendor:'apple',isFallbackAdapter:mode==='fallback'},limits:{},async requestDevice(){return device;}},
    route={routeId:SLAT_CONVOLUTION_ROUTE,runtime,enqueue:job=>({completion:Promise.resolve(job.execute({})).then(output=>({status:'succeeded',output}))})},
    session={async registerRoute(){return route;},snapshot:()=>({sessionId:'cpu-control-flow-only'}),async drain(){},close(){disposed.push('session');}},
    fetch=async(url,options)=>{
      if(url.startsWith('/fixture/')){const n=url.slice(9),raw=encoded[n]??arrays[n.slice(0,-4)];return {ok:!!raw,async arrayBuffer(){return raw.buffer;}};}
      if(url.startsWith('/output/')){saved[url.slice(8)]=options.body.slice();return {ok:true};}throw Error('unknown test route');
    },deps={createWebGpuInferenceSession:async()=>session,createSLatDecoderKernelOps:()=>ops,
      SLAT_CONVOLUTION_ROUTE,validateSLatConvolutionFixture:()=>plan,validateSLatConvolutionResult,
      compareSLatDecoderObservation,validateNativePrefixBackend:b=>{if(b.isFallbackAdapter)throw Error('fallback backend');},
      prefixAdapterName:()=> 'test',preserveSamplerWitnessFailure,recordSamplerCompletion,fetch,crypto:webcrypto,
      navigator:{gpu:{async requestAdapter(){return adapter;}}}};
  // Inject CPU dependencies into the checked-in control flow, not a substitute
  // numeric oracle. Live conformance still requires the actual native route.
  const run=new Function(...Object.keys(deps),body+'\nreturn runSLatConvolutionWitness;')(...Object.values(deps)),report=await run(hash(encoded['manifest.json']));
  assert.equal(report.status,'failed');assert.ok(report.error,mode);
  if(mode==='fallback'){assert.equal(started,false);assert.deepEqual(Object.keys(saved),[]);}
  else{
    assert.equal(started,true);assert.deepEqual(Object.keys(saved).sort(),['convolution','neighbors'],mode);
    assert.equal(saved.neighbors.length,81);assert.equal(saved.convolution.length,mode==='partial-output'?1:48);
    assert.deepEqual(disposed,['ops','session','device']);
    if(mode==='numeric-mismatch')assert.equal(report.outputs.neighbors.comparison.passed,true);
    if(mode==='neighbor-mismatch')assert.equal(report.outputs.convolution.comparison.passed,true);
  }
}
console.log('Actual convolution witness retains both outputs under negative numerics/profile; fallback never launches compute (CPU control-flow only).');
