// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Execute the production allocation block with a recording GPU. Grid dimensions
// are runtime uniforms; replacing field buffers must not compile the same code
// again. This tests lifetime only, not WebGPU compilation or rendered output.
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('    const renderPipelineConstants =');
const end=source.indexOf('    fourArmHeldStateResidualParamsBuffer?.destroy();',start);
assert.ok(start>=0&&end>start);
const guardStart=source.lastIndexOf('    if (fluidPipelineDevice !== device',start);
const block=source.slice(guardStart>source.lastIndexOf('function rebuildFluidState',start)?guardStart:start,end);
function fixture(){
 const created=[];
 const make=kind=>descriptor=>{const resource={kind,descriptor};created.push(resource);return resource;};
 const device=()=>({createRenderPipeline:make('render'),createComputePipeline:make('compute'),createBindGroupLayout:make('bind-layout'),createPipelineLayout:make('layout')});
 const context={device:device(),fluidPipelineDevice:null,fluidPipelineTransparency:null,optionalPipelines:{},transparentCanvas:true,format:'bgra8unorm',externalDepthFormat:'depth32float',productFrameOwner:'caller',gridSize:32,gridHeight:64,gridShapeLabel:n=>`${n}`,GPUShaderStage:{FRAGMENT:2},BOUNDARY_SPLAT_OPTICAL_DEPTH_BINS:4};
 // Imported shader/layout handles and label constants are opaque to this test.
 for(const m of block.matchAll(/\b(?:layout|module):\s*([a-zA-Z]\w*)/g))if(!(m[1] in context))context[m[1]]={name:m[1]};
 for(const m of block.matchAll(/\b[A-Z][A-Z_]+\b/g))if(!(m[0] in context))context[m[0]]=m[0];
 for(const name of ['ordinaryDepthPipelines','opticalSteppingPipelines','scenePointPipelines','distributedPipelines'])context[name]=new Map();
 vm.createContext(context);
 const rebuild=()=>vm.runInContext(`(()=>{${block}})()`,context);
 return {context,created,rebuild,device};
}
test('field resize and scene restoration reuse pipelines on the same device',()=>{
 const f=fixture();f.rebuild();const count=f.created.length,first=f.context.computePipeline;
 assert.ok(count>0,'first use constructs real descriptors');
 f.context.gridSize=64;f.context.gridHeight=128;f.rebuild();
 assert.equal(f.created.length,count,'grid-only rebuild must not recreate device pipelines');
 assert.equal(f.context.computePipeline,first);
});
test('a replacement device gets its own pipelines',()=>{
 const f=fixture();f.rebuild();const count=f.created.length,first=f.context.computePipeline;
 f.context.device=f.device();f.rebuild();
 assert.equal(f.created.length,2*count);assert.notEqual(f.context.computePipeline,first);
});
test('changing canvas transparency refreshes the shader specialization',()=>{
 const f=fixture();f.rebuild();
 const first=f.context.pipeline;
 f.context.transparentCanvas=false;f.rebuild();
 assert.notEqual(f.context.pipeline,first);
 assert.equal(f.context.pipeline.descriptor.fragment.constants.TRANSPARENT_CANVAS,0);
});
test('ordinary field initialization defers optional renderers and diagnostic captures',()=>{
 const f=fixture();f.rebuild();
 const entries=()=>f.created.map(p=>p.descriptor.compute?.entryPoint??p.descriptor.fragment?.entryPoint);
 for(const entry of ['compactBoundarySplats','boundarySplatFs','boundarySplatOpticalFs','fsResidualSource','fsOpticalTransportContributions','fourArmHeldStateResolveFs'])assert.ok(!entries().includes(entry),`${entry} must wait for a consumer`);
 const count=f.created.length;
 const first=f.context.optionalPipelines.opticalTransportContributionPipeline;
 assert.equal(first.descriptor.fragment.entryPoint,'fsOpticalTransportContributions');
 assert.equal(f.created.length,count+1);
 assert.equal(f.context.optionalPipelines.opticalTransportContributionPipeline,first);
 assert.equal(f.created.length,count+1,'repeat access reuses the pipeline');
});
