import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
import {createTrellisMeshAdapter,encodeTrellisGeometryGLB} from '../trellis-mesh.js';
import {compareSLatDecoderObservation} from '../slat-decoder-witness-checks.js';
import {preserveSamplerWitnessFailure,recordSamplerCompletion} from '../sparse-sampler-witness-checks.js';
// Exercise the actual witness control flow with injected CPU dependencies.
// This deliberately makes no GPU, external-reference or numerical admission claim.
const source=await fs.readFile(new URL('../sparse-slat-decoder-witness.js',import.meta.url),'utf8'),
  body=source.replace(/^import .*;\n/gm,'').replace('export async function','async function'),
  hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const mode of ['no-surface','failed-upload','changed-receipt']) {
  const features=new Float32Array(28);if(mode!=='no-surface')features[3]=1;
  const coordinates=new Int32Array([0,0,0,0,0,1,0,1,1,0,1,0]),subdivision=new Float32Array(32),
    arrays={sample:new Float32Array(8),coordinates,halfInputs:new Float32Array(65536),
      'expected.features':features,'expected.coordinates':coordinates,'expected.subdivision0':subdivision},
    tensors=Object.fromEntries(Object.entries(arrays).map(([n,a])=>[n,{file:n+'.raw',dtype:a instanceof Int32Array?'int32':'float32',
      shape:[a.length],byteLength:a.byteLength,sha256:hash(a)}])),manifest={tensors,config:{}},
    manifestBytes=new TextEncoder().encode(JSON.stringify(manifest)),saved={},destroyed=[],reads=[];
  const tensor=(name,shape,dtype='f32',data)=>({name,shape,dtype,byteLength:shape.reduce((a,b)=>a*b,4),usage:U.storage,
    data:data??new Float32Array(shape.reduce((a,b)=>a*b,1)),buffer:{destroy(){destroyed.push(name);}}});
  const observed={features:tensor('features',[4,7],'f32',features),coordinates:tensor('coordinates',[4,3],'i32',coordinates),
    subdivisions:[tensor('subdivision0',[4,8],'f32',subdivision)],resolution:2};
  const runtime={device:{queue:{async onSubmittedWorkDone(){}}},createTensor:({name,shape,dtype})=>tensor(name,shape,dtype),
    uploadTensor(t,a){t.data=a;},defineComputeKernel:k=>k,async runKernel(){},
    async readTensor(t){reads.push(t);return t.data.buffer.slice(t.data.byteOffset,t.data.byteOffset+t.data.byteLength);},finishProfile(){return {};}};
  let decoderDisposed=false;
  const route={routeId:'test-decoder',runtime,enqueue:job=>({completion:Promise.resolve(job.execute({})).then(output=>({status:'succeeded',output}))})},
    session={async registerRoute(){return route;},snapshot:()=>({sessionId:'cpu-control-flow-only'}),async drain(){},close(){}},
    device={limits:{maxComputeWorkgroupsPerDimension:65535},pushErrorScope(){},addEventListener(){},async popErrorScope(){return null;},destroy(){}},
    adapter={info:{},limits:{},async requestDevice(){return device;}};
  const fetch=async(url,options)=>{
    if(url==='/fixture/manifest.json')return {ok:true,async arrayBuffer(){return manifestBytes.buffer;}};
    if(url.startsWith('/fixture/')){const n=url.slice(9,-4),a=arrays[n];return {ok:!!a,async arrayBuffer(){return a.buffer;}};}
    if(url.startsWith('/output/')){saved[url.slice(8)]=options.body.slice();return {ok:true};}
    if(url==='/mesh-output')return {ok:mode!=='failed-upload',async json(){return {sha256:'0'.repeat(64),byteLength:options.body.byteLength};}};
    throw Error('unhandled test fetch '+url);
  };
  const deps={U,createWebGpuInferenceSession:async()=>session,
    createTrellisSLatDecoderAdapter:({sampleTensor,coordinateTensor})=>({inputs:{sample:sampleTensor,coordinates:coordinateTensor},
      async run(){return observed;},dispose(){decoderDisposed=true;for(const t of [observed.features,observed.coordinates,...observed.subdivisions])t.buffer.destroy();}}),
    SLAT_DECODER_ROUTE:'test-decoder',validateSLatDecoderFixture:()=>({mode:'shape',tokenRows:4,latentChannels:2,subdivisionLevels:1,stages:[],storage:'test'}),
    compareSLatDecoderObservation,validateNativePrefixBackend:()=>{},prefixAdapterName:()=> 'test',
    preserveSamplerWitnessFailure,recordSamplerCompletion,createTrellisMeshAdapter,encodeTrellisGeometryGLB,fetch,
    crypto:webcrypto,navigator:{gpu:{async requestAdapter(){return adapter;}}}};
  const run=new Function(...Object.keys(deps),body+'\nreturn runSLatDecoderWitness;')(...Object.values(deps)),
    report=await run(hash(manifestBytes),{meshOutput:true});
  assert.equal(report.status,'failed');assert.equal(report.phase,'learned-mesh-consumer',JSON.stringify(report.error));
  assert.deepEqual(Object.keys(saved).sort(),['coordinates','features','halfRoundTrip','subdivision0'],
    'A downstream '+mode+' must not discard the completed decoder observations.');
  assert.deepEqual([...saved.features],[...features]);assert.deepEqual([...saved.coordinates],[...coordinates]);
  assert.equal(report.outputs.features.comparison.passed,true);assert.equal(report.outputs.coordinates.comparison.passed,true);
  assert.equal(reads.filter(t=>t===observed.features).length,1,'Reuse the retained feature readback for conversion.');
  assert.equal(reads.filter(t=>t===observed.coordinates).length,1,'Reuse the retained coordinate readback for conversion.');
  assert.equal(decoderDisposed,true);assert.ok(destroyed.includes('features'));
}
console.log('Actual witness preserves completed observations through no-surface, failed-upload and changed-receipt cleanup; CPU control-flow evidence only.');
