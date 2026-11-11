// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Execute the production allocation block. This recording device proves which
// factories run, independently of the native shader/output witness.
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('    const renderPipelineConstants =');
const end=source.indexOf('    ensureOpticalTraceBuffers();',start);
assert.ok(start>=0&&end>start);
const block=source.slice(start,end);
function fixture(){
 const created=[];
 const device={createRenderPipeline:d=>{const p={descriptor:d};created.push(p);return p;},createComputePipeline:d=>{const p={descriptor:d};created.push(p);return p;}};
 const context={device,format:'bgra8unorm',transparentCanvas:true,productFrameOwner:'caller',gridSize:8,gridShapeLabel:n=>String(n)};
 for(const m of block.matchAll(/\b(?:layout|module):\s*(\w+)/g))context[m[1]]={name:m[1]};
 for(const m of block.matchAll(/\b[A-Z][A-Z_]+\b/g))if(!(m[0] in context))context[m[0]]=m[0];
 for(const m of block.matchAll(/^\s*(\w+)\s*=(?!=)/gm))context[m[1]]=null;
 context.fluidPipelineShader=null;
 for(const name of ['ordinaryDepthPipelines','opticalSteppingPipelines','scenePointPipelines','distributedPipelines','simulationVariants'])context[name]=new Map();
 return {created,context,async initialize(){
  if(!context.gpuPipelines){try{const {createDeferredPipelines}=await import('../deferred-pipelines.mjs');context.gpuPipelines=createDeferredPipelines(device);}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}}
  vm.runInNewContext(`{${block}}`,context);
 },submit(p){return context.gpuPipelines?.resolve(p)??p;}};
}
test('grid allocation leaves every pipeline uncompiled until a pass consumes it',async()=>{
 const f=fixture();await f.initialize();assert.equal(f.created.length,0,'field allocation compiled a renderer or optional simulation pipeline');
 const selected=f.submit(f.context.computePipeline);assert.equal(f.created.length,1);assert.equal(selected.descriptor.compute.entryPoint,'cs');
 assert.equal(f.submit(f.context.computePipeline),selected);assert.equal(f.created.length,1);
});
test('grid rebuild reuses selected pipelines and retains independent specializations',async()=>{
 const f=fixture();await f.initialize();const first=f.submit(f.context.computePipeline),render=f.submit(f.context.pipeline);const count=f.created.length;
 f.context.gridSize=16;await f.initialize();assert.equal(f.submit(f.context.computePipeline),first);assert.equal(f.submit(f.context.pipeline),render);assert.equal(f.created.length,count);
 f.context.transparentCanvas=false;await f.initialize();const opaque=f.submit(f.context.pipeline);assert.notEqual(opaque,render);assert.equal(opaque.descriptor.fragment.constants.TRANSPARENT_CANVAS,0);assert.equal(f.submit(f.context.computePipeline),first);
 f.context.transparentCanvas=true;await f.initialize();assert.equal(f.submit(f.context.pipeline),render);
});

test('derived optical renderer survives grid edits and distinguishes canvas transparency',async()=>{
 const {createDeferredPipelines}=await import('../deferred-pipelines.mjs');
 const a=source.indexOf('    const opticalKey ='),b=source.indexOf('    if (multisampled)',a);assert.ok(a>=0&&b>a);
 const device={createPipelineLayout:d=>d,createRenderPipeline:d=>({descriptor:d})};
 const context={optical:{mode:'experimental'},rayStepTelemetry:{active:false},reconstruct:false,splitActive:false,particleSourceOnly:false,multisampled:false,scenePointBindGroup:null,distributedGroup:null,targetPipeline:{},readbackPipeline:{},gridSize:8,gridHeight:12,opticalSteppingPipelines:new Map(),gpuPipelines:createDeferredPipelines(device),device,bindGroupLayout:{},productRaymarchDepthBindGroupLayout:{},nativeShader:{},entryPoint:'fs',opticalConstants:{},colorTargets:[{format:'rgba8unorm'}],transparentCanvas:true,drawPipeline:null};
 const select=()=>new Function(...Object.keys(context),source.slice(a,b)+';return drawPipeline;')(...Object.values(context));
 const first=select();context.gridSize=16;context.gridHeight=24;assert.equal(select(),first,'grid-only edit recompiled the selected derived renderer');
 context.transparentCanvas=false;assert.notEqual(select(),first,'transparency edit reused the wrong specialization');
});

// Run the production initialization admission separately from GPU factories.
// Before coalescing existed, the same prefix invoked the controlled factory
// twice. The heavy body is substituted only at its first status publication.
const gpuStart=source.indexOf('  async function ensureGpu() {');
let admission=source.slice(gpuStart,source.indexOf('\n  }',gpuStart)+4);
const heavy=admission.indexOf("    state.gpuInitStage = 'adapter';");
if(heavy>=0)admission=admission.slice(0,heavy)+'    return initializeGpu();\n  }';
test('overlapping GPU activation shares initialization, and a failed attempt permits retry',async()=>{
 let calls=0,release,reject;
 const context={gpuInitialized:false,gpuInitialization:null,initializeGpu(){calls++;return new Promise((yes,no)=>{release=yes;reject=no;});}};
 vm.createContext(context);vm.runInContext(admission,context);
 const first=context.ensureGpu(),second=context.ensureGpu();
 assert.equal(calls,1,'overlapping activation acquired GPU resources twice');
 release();await Promise.all([first,second]);
 const failed=context.ensureGpu();assert.equal(calls,2);reject(Error('acquisition failed'));await assert.rejects(failed,/acquisition failed/);
 const retry=context.ensureGpu();assert.equal(calls,3);release();await retry;
 context.gpuInitialized=true;await context.ensureGpu();assert.equal(calls,3,'initialized viewer must retain its device');
});
test('a fresh shader/device invalidates derived closure caches while grid rebuilds retain them',async()=>{
 const f=fixture();f.context.shader={};await f.initialize();
 const maps=['ordinaryDepthPipelines','opticalSteppingPipelines','scenePointPipelines','distributedPipelines','simulationVariants'];
 for(const key of maps)f.context[key].set('old',{});
 await f.initialize();for(const key of maps)assert.equal(f.context[key].size,1,'compatible grid rebuild lost '+key);
 f.context.shader={};f.context.device={...f.context.device};
 const {createDeferredPipelines}=await import('../deferred-pipelines.mjs');f.context.gpuPipelines=createDeferredPipelines(f.context.device);
 await f.initialize();for(const key of maps)assert.equal(f.context[key].size,0,'fresh GPU initialization retained stale '+key);
});
