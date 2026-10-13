import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OPTICAL_TRACE_IDENTITY,traceChunkPlan,validateTraceRows} from '../volume-optical-trace.mjs';

// Exercise the actual API body with a synthetic GPU readback, not GPU conformance.
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const body=core.match(/async function sampleOpticalTraceChunkOwned\(options = \{\}\) \{([\s\S]*?)\n  \}\n\n  async function sampleEmissiveLightProfile/)[1];
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const raw=new Float32Array(64);
raw.set([0,0,1,1]);raw[16]=-0.5;
raw.set([0,1,0,1],32);
const destroyed=[];
const buffer=label=>({getMappedRange:()=>raw.buffer,mapAsync:async()=>{},unmap(){},destroy(){destroyed.push(label);}});
const device={limits:{maxBufferSize:256,maxStorageBufferBindingSize:256},
  createBuffer:({label})=>buffer(label),pushErrorScope(){},popErrorScope:async()=>null,
  createCommandEncoder:()=>({copyBufferToBuffer(){},finish(){return {};}}),queue:{writeBuffer(){},submit(){}}};
const uniforms=new Float32Array(400);uniforms[368]=2;
const environment={state:{active:true,simStepCount:151,physicalColor:{incidentLight:{}},raymarchShaderSpecialization:{}},
  device,selectiveHeadLiveCapturePaused:true,opticalTraceCaptureActive:false,
  nonRidgeOpticalCaptureSession:null,nonRidgeSourceBasisCaptureSession:null,
  nonRidgeOpticalCaptureRowBuffer:{},debugRaymarchShaderSpecialization:'auto',
  updateUniforms(){},uniforms,boundarySplatRequested:()=>false,browserResidualCanApply:()=>false,
  productFrameOwner:'prototype',ensureFrameTexture(){},frameTexture:{width:1,height:1,createView(){}},
  traceChunkPlan,OPTICAL_TRACE_IDENTITY,GPUBufferUsage:{STORAGE:1,COPY_SRC:2,COPY_DST:4,MAP_READ:8},GPUMapMode:{READ:1},
  rebuildNonRidgeOpticalCaptureBindGroups(){},nonRidgeOpticalCaptureHeaderBuffer:{},prepareSharedSceneConsumers:x=>x,
  distributedGroup:{},encodeBoundarySidecar(){},encodeDraw(){},readbackPipeline:{},controlsSnapshot:{},validateTraceRows};
const result=await new AsyncFunction(...Object.keys(environment),'options',body)(...Object.values(environment),{
  now:4000,specialization:'auto',firstRay:0,rayCount:1,sampleOffset:0,sampleCount:2,subdivisions:1});
assert.equal(result.ok,false);
assert.equal(result.phase,'validation');
assert.deepEqual(result.values,raw,'validation failure must retain the unmodified GPU readback');
assert.equal(result.plan.byteLength,256);
assert.equal(result.effective.simStepCount,151);
assert.equal(destroyed.length,2,'failed readback still releases owned GPU allocations');

const script=readFileSync(new URL('../scripts/capture-optical-trace.mjs',import.meta.url),'utf8');
const start=script.indexOf('      const chunk=await page.evaluate');
const end=script.indexOf('      validateTraceSpecialization',start);
const driver=script.slice(start,end);
const callback=script.slice(start).match(/page.evaluate\((async options=>\{[\s\S]*?)\n      \},\{firstRay/)[1]+'\n      }';
const backing=new Uint8Array(0x10020);
for(let i=0;i<backing.length;i++)backing[i]=i%256;
const offsetView=new Float32Array(backing.buffer,12,0x10000/4);
const wire=await new Function('window','options',`return (${callback})(options);`)(
  {__kaminosVolumePrototype:{sampleOpticalTraceChunk:async()=>({values:offsetView})}},{});
assert.equal(typeof wire.readbackBase64,'string','binary readback must cross Playwright as one encoded string, not a per-byte JS array');
assert.equal(wire.readbackBytes,undefined);
assert.ok(Buffer.from(JSON.parse(JSON.stringify(wire)).readbackBase64,'base64').equals(Buffer.from(backing.buffer,12,0x10000)));
for(const word of [0xbf000000,0x7f800001,0xff800001,0x7fc12345,0x80000000]) {
  const sample=raw.slice();new Uint32Array(sample.buffer)[19]=word;
  const writes=[];let saved=0;
  const report={chunks:[]};
  const window={__kaminosVolumePrototype:{sampleOpticalTraceChunk:async()=>({...result,values:sample})}};
  const page={evaluate:async(fn,options)=>new Function('window','options',`return (${fn})(options);`)(window,options)};
  await assert.rejects(new AsyncFunction('page','height','width','fraction','specialization','subdivisions','fs','out','createHash','report','save','assert',driver)(
    page,1,1,.25,'force-full',1,{writeFile:async(path,bytes)=>writes.push({path,bytes})},'/synthetic',createHash,report,async()=>{saved++;},assert));
  assert.equal(writes.length,1,'driver must persist rejected readback before reporting validation failure');
  assert.ok(writes[0].bytes.equals(Buffer.from(sample.buffer)),`readback word ${word.toString(16)} changed`);
  assert.equal(report.chunks[0].ok,false);
  assert.equal(report.chunks[0].phase,'validation');
  assert.equal(report.chunks[0].sha256,createHash('sha256').update(Buffer.from(sample.buffer)).digest('hex'));
  assert.equal(saved,1);
}
console.log('failed optical readbacks remain retained, attributed, and rejected');
