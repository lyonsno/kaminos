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
 for(const name of ['ordinaryDepthPipelines','opticalSteppingPipelines','scenePointPipelines','distributedPipelines'])context[name]=new Map();
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

test('unused single-scattering field allocates bindable storage without compiling; first encode compiles once per device and module',async()=>{
 const {createEmissiveLightField}=await import('../volume-emissive-transport.mjs');
 globalThis.GPUBufferUsage ??= {STORAGE:1,COPY_SRC:2,COPY_DST:4};
 const created=[],buffer={destroy(){}},texture={createView:()=>({})};
 const device={createBuffer:()=>({...buffer}),createComputePipeline:d=>{created.push(d);return {getBindGroupLayout:i=>({entry:d.compute.entryPoint,i})};},createBindGroup:d=>d};
 const module={},uniform={},fluids=[buffer,buffer],fronts=[buffer,buffer],textures=[texture,texture];
 const make=()=>createEmissiveLightField(device,module,uniform,fluids,fronts,()=>textures);
 const pass={setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};const encoder={beginComputePass:()=>pass};
 const field=make();assert.ok(field.incident);assert.equal(created.length,0,'unused field compiled scattering pipelines');
 field.encode(encoder,0);assert.equal(created.length,3);field.destroy();
 const replacement=make();replacement.encode(encoder,1);assert.equal(created.length,3,'field replacement recompiled scattering pipelines');replacement.destroy();
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
