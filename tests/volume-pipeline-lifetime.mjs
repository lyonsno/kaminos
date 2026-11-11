// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDeferredRenderPipelines} from '../deferred-render-pipelines.mjs';
import {readFileSync} from 'node:fs';
import {createDisplayReconstruction} from '../volume-display-reconstruction.mjs';
import {createSceneVolumeSource} from '../scene-volume-source.mjs';
import {createScatteredSource} from '../scene-volume-scattering.mjs';
import {createGpuSceneSolidProducer} from '../scene-solid-gpu.mjs';
import {createWorldSmoke} from '../volume-world-smoke.mjs';
import {createMaterialHierarchyGPU} from '../volume-material-hierarchy-gpu.mjs';
import {createWorldSeed} from '../volume-world-seed.mjs';
import {createFineVelocityGrid, fineGridPlan} from '../volume-fine-grid.mjs';
import {createPressureTransfer, pressureResolutionPlan} from '../volume-pressure-resolution.mjs';
import {createOpenBoundary} from '../volume-open-boundary.mjs';
import {createBvhReproject} from '../scene-bvh-reproject.mjs';
import {createPreparedSmoke} from '../scene-prepared-smoke.mjs';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {createSpatialReducer} from '../scene-spatial-point-regions.mjs';
import {createFireSmokeShadow} from '../fire-smoke-shadow.mjs';
import {createShadowMedium} from '../scene-shadow-medium.mjs';

globalThis.GPUBufferUsage ??= {MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512};
globalThis.GPUTextureUsage ??= {COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16};
globalThis.GPUShaderStage ??= {VERTEX: 1, FRAGMENT: 2, COMPUTE: 4};

// Execute the production allocation block with a recording GPU. Grid dimensions
// are runtime uniforms; replacing field buffers must not compile the same code
// again. This tests lifetime only, not WebGPU compilation or rendered output.
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('    const renderPipelineConstants =');
const end=source.indexOf('    fourArmHeldStateResidualParamsBuffer?.destroy();',start);
assert.ok(start>=0&&end>start);
const guardStart=source.lastIndexOf('    if (fluidPipelineDevice !== device',start);
const block=source.slice(guardStart>source.lastIndexOf('function rebuildFluidState',start)?guardStart:start,end);
const protoStart=source.indexOf('export function createKaminosVolumePrototype(');
const protoDeclarations=new Set([...source.slice(protoStart).matchAll(/\b(?:let|const|var|function)\s+([a-zA-Z_$][\w$]*)/g)].map(m=>m[1]));
for(const m of block.matchAll(/^\s*([a-zA-Z_$][\w$]*)\s*(?:=\s*null\s*;|\.clear\(\)\s*;)/gm)){
 assert.ok(protoDeclarations.has(m[1]),`${m[1]} in pipeline reset block must be declared in createKaminosVolumePrototype`);
}

function sliceFunction(name){
 const fnStart=source.indexOf(`  function ${name}(`);
 assert.ok(fnStart>=0,`missing function ${name}`);
 const nextFn=source.indexOf('\n  function ',fnStart+1);
 const endIdx=source.indexOf('\n  }',fnStart);
 assert.ok(endIdx>fnStart,`missing end of ${name}`);
 return source.slice(fnStart,nextFn>fnStart&&nextFn<endIdx?nextFn:endIdx+4);
}

const renderSelectionStart=source.indexOf('    const opticalKey =');
const renderSelectionEnd=source.indexOf('    if (uniforms[368] > 1.5)',renderSelectionStart);
assert.ok(renderSelectionStart>=0&&renderSelectionEnd>renderSelectionStart);
const renderSelectionBlock=source.slice(renderSelectionStart,renderSelectionEnd);

const irradianceBlock=[
 sliceFunction('destroyFireIrradianceResources'),
 sliceFunction('ensureFireIrradianceResources'),
].join('\n');

function fixture(){
 const created=[];
 const make=kind=>descriptor=>{
  const resource={
   kind,
   descriptor,
   getBindGroupLayout:index=>({kind:'auto-bind-layout',pipeline:descriptor?.label,index}),
   createView:()=>({kind:'view',label:descriptor?.label}),
   destroy(){},
  };
  created.push(resource);
  return resource;
 };
 const device=()=>({
  limits:{maxStorageBufferBindingSize:2**30,maxBufferSize:2**30,maxComputeWorkgroupsPerDimension:65535,maxTextureDimension2D:8192,maxTextureDimension3D:2048},
  queue:{writeBuffer(){},writeTexture(){},submit(){},onSubmittedWorkDone:async()=>{}},
  createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})}),
  createShaderModule:make('shader'),
  createRenderPipeline:make('render'),
  createComputePipeline:make('compute'),
  createBindGroupLayout:make('bind-layout'),
  createPipelineLayout:make('layout'),
  createBuffer:descriptor=>({kind:'buffer',descriptor,destroy(){}}),
  createTexture:descriptor=>({kind:'texture',descriptor,createView:()=>({kind:'view',label:descriptor?.label}),destroy(){}}),
  createSampler:descriptor=>({kind:'sampler',descriptor}),
  createBindGroup:descriptor=>({kind:'bind-group',descriptor}),
 });
 const deferred=createDeferredRenderPipelines();
 const context={
  deferRenderPipeline:deferred.defer,resolveRenderPipeline:deferred.resolve,
  device:device(),
  fluidPipelineDevice:null,
  fluidPipelineTransparency:null,
  fluidRenderPipelines:new Map(),
  optionalPipelines:{},
  transparentCanvas:true,
  format:'bgra8unorm',
  externalDepthFormat:'depth32float',
  productFrameOwner:'caller',
  gridSize:32,
  gridHeight:64,
  gridShapeLabel:n=>`${n}`,
  GPUShaderStage:globalThis.GPUShaderStage,
  GPUBufferUsage:globalThis.GPUBufferUsage,
  GPUTextureUsage:globalThis.GPUTextureUsage,
  BOUNDARY_SPLAT_OPTICAL_DEPTH_BINS:4,
  IRRADIANCE_DIRECTIONS:6,
  IRRADIANCE_LATTICE_FLOATS:6,
  fireIrradianceSolver:'lattice',
  readbackPipeline:{label:'readback'},
  WGSL:'var productSceneDepth: texture_depth_2d; let depth = textureLoad(productSceneDepth, pixel, 0); medium.scattering * incidentAt(p) fn opticalIncidentMaskFlags(p: vec3<f32>) -> vec2<f32> { return vec2<f32>(0.0); }',
  SCENE_POINT_SMOKE_WGSL:'/* scene point wgsl */',
  DISTRIBUTED_SMOKE_WGSL:'/* distributed wgsl */',
  scenePointBindings:{layout:{name:'scenePointLayout'}},
  distributedLayout:{name:'distributedLayout'},
  sceneVolumeSource:{describe:()=>({generation:1})},
  sceneSourceFrameConsumer:true,
  scenePointFrame:{generation:1},
  distributedFrame:{generation:1},
  optical:{mode:'current'},
  rayStepTelemetry:{active:false},
  opticalConstants:{},
  options:{},
  fineVelocity:null,
  fineVelocityPipelines:new Map(),
  simulationVariants:new Map(),
  scenePointShaders:new Map(),
  distributedShaders:new Map(),
  separatedPressure:null,
  separatedPressureProjectPipeline:null,
  irradianceResourcesKey:null,
  irradianceLatticeBuffers:null,
  irradianceAtlasTexture:null,
  irradianceAtlasView:null,
  irradianceMetaTexture:null,
  irradianceMetaView:null,
  irradianceBindGroups:null,
  irradianceLatticeBindGroupLayout:null,
  irradiancePipelineLayout:null,
  irradianceSeedPipeline:null,
  irradiancePropagatePipeline:null,
  irradianceResolvePipeline:null,
  irradianceAnalyticPipeline:null,
  emissionExtentPipeline:null,
  irradianceAtlasGeneration:0,
  sampler:{},
  simParamsBuffer:{},
  fieldTextureAView:{},
  fieldTextureBView:{},
  emissionBoundsBuffer:{},
  bindGroupLayout:{name:'bindGroupLayout'},
  productRaymarchDepthBindGroupLayout:{name:'productRaymarchDepthBindGroupLayout'},
  ordinaryMultisampleDepthLayout:{name:'ordinaryMultisampleDepthLayout'},
  boundarySidecarReadBindGroupLayout:{name:'boundarySidecarReadBindGroupLayout'},
  irradianceAtlasBindGroupLayout:{name:'irradianceAtlasBindGroupLayout'},
  computeShader:{name:'computeShader'},
  irradianceGridSize:16,
  gridHeightForSize:n=>n,
  irradianceLatticeBufferBytes:(s,h)=>s*h*s*64,
  FIRE_IRRADIANCE_ATLAS_TILES_X:4,
  FIRE_IRRADIANCE_LATTICE_IDENTITY:'lattice',
  FIRE_IRRADIANCE_ATLAS_IDENTITY:'atlas',
  state:{},
 };
 // Imported shader/layout handles and label constants are opaque to this test.
 for(const name of protoDeclarations)if(!(name in context))context[name]=null;
 for(const m of block.matchAll(/\b(?:layout|module):\s*([a-zA-Z]\w*)/g))if(!context[m[1]])context[m[1]]={name:m[1]};
 for(const m of block.matchAll(/\b[A-Z][A-Z_]+\b/g))if(!context[m[0]])context[m[0]]=m[0];
 for(const name of ['ordinaryDepthPipelines','opticalSteppingPipelines','scenePointPipelines','distributedPipelines'])context[name]=new Map();
 vm.createContext(context);
 vm.runInContext(irradianceBlock,context);
 const rebuild=()=>vm.runInContext(`(()=>{'use strict';${block}})()`,context);
 const selectRender=(overrides={})=>vm.runInContext(`(()=>{'use strict';let {drawPipeline=pipeline,targetPipeline=pipeline,multisampled=false,scenePointBindGroup=null,distributedGroup=null,selectEmissive=false}=${JSON.stringify(overrides)};${renderSelectionBlock};return drawPipeline;})()`,context);
 return {context,created,rebuild,selectRender,device};
}
test('field resize and scene restoration reuse pipelines on the same device',()=>{
 const f=fixture();
 f.context.simulationVariants.set('cached-variant',{label:'variant'});
 f.rebuild();const count=f.created.length,first=f.context.computePipeline;
 assert.ok(count>0,'first use constructs real descriptors');
 assert.equal(f.context.simulationVariants.size,0,'initial device attachment clears stale simulation variants');
 f.context.simulationVariants.set('same-device-variant',{label:'variant'});
 f.context.gridSize=64;f.context.gridHeight=128;f.rebuild();
 assert.equal(f.created.length,count,'grid-only rebuild must not recreate device pipelines');
 assert.equal(f.context.computePipeline,first);
 assert.equal(f.context.simulationVariants.size,1,'grid-only rebuild preserves specialized simulation variants on the same device');
});
test('a replacement device gets its own pipelines',()=>{
 const f=fixture();f.rebuild();const count=f.created.length,first=f.context.computePipeline;
 f.context.simulationVariants.set('device-1-variant',{label:'variant'});
 f.context.device=f.device();f.rebuild();
 assert.equal(f.created.length,2*count);assert.notEqual(f.context.computePipeline,first);
 assert.equal(f.context.simulationVariants.size,0,'replacement device clears specialized simulation variants');
});
test('changing canvas transparency refreshes the shader specialization without recompiling compute pipelines or discarding cached transparency variants',()=>{
 const f=fixture();f.rebuild();
 f.context.ensureFireIrradianceResources();
 const firstRender=f.context.pipeline;
 const firstCompute=f.context.computePipeline;
 const firstSeed=f.context.irradianceSeedPipeline;
 const afterTransparent=f.created.length;
 f.context.transparentCanvas=false;f.rebuild();
 const opaqueRender=f.context.pipeline;
 assert.notEqual(opaqueRender,firstRender);
 assert.equal(f.context.resolveRenderPipeline(opaqueRender).descriptor.fragment.constants.TRANSPARENT_CANVAS,0);
 assert.equal(f.context.computePipeline,firstCompute,'canvas transparency toggle must not recreate compute pipelines');
 assert.equal(f.context.irradianceSeedPipeline,firstSeed,'canvas transparency toggle must not discard irradiance compute pipelines');
 const createdOnOpaque=f.created.slice(afterTransparent);
 assert.ok(createdOnOpaque.every(r=>r.kind==='render'),'canvas transparency toggle must only create render pipelines');
 const afterOpaque=f.created.length;
 f.context.transparentCanvas=true;f.rebuild();
 assert.equal(f.context.pipeline,firstRender,'returning to previous canvas transparency reuses cached render pipeline');
 assert.equal(f.created.length,afterOpaque,'cached transparency toggle must not create new GPU pipelines');
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
test('optical stepping, scene point, and distributed render pipelines reuse across grid resizes',()=>{
 const f=fixture();f.rebuild();
 f.context.optical={mode:'experimental'};
 const optical32=f.selectRender({});
 f.context.optical={mode:'current'};
 const point32=f.selectRender({scenePointBindGroup:{}});
 const dist32=f.selectRender({distributedGroup:{}});
 const afterFirst=f.created.length;
 f.context.gridSize=48;f.context.gridHeight=48;
 f.context.optical={mode:'experimental'};
 const optical48=f.selectRender({});
 f.context.optical={mode:'current'};
 const point48=f.selectRender({scenePointBindGroup:{}});
 const dist48=f.selectRender({distributedGroup:{}});
 assert.equal(optical48,optical32,'optical stepping pipeline is grid-independent');
 assert.equal(point48,point32,'scene point pipeline is grid-independent');
 assert.equal(dist48,dist32,'distributed pipeline is grid-independent');
 assert.equal(f.created.length,afterFirst,'grid resize must not recompile scene point or distributed shaders');
});
test('fire irradiance solver reuses layouts and compute pipelines across grid resizes on the same device',()=>{
 const f=fixture();f.rebuild();
 f.context.ensureFireIrradianceResources();
 const seed32=f.context.irradianceSeedPipeline;
 const prop32=f.context.irradiancePropagatePipeline;
 const afterFirst=f.created.length;
 assert.ok(seed32&&prop32);
 f.context.gridSize=48;f.context.gridHeight=48;
 f.context.destroyFireIrradianceResources();
 f.rebuild();
 f.context.ensureFireIrradianceResources();
 assert.equal(f.context.irradianceSeedPipeline,seed32,'irradiance seed pipeline reused across grid resize');
 assert.equal(f.context.irradiancePropagatePipeline,prop32,'irradiance propagate pipeline reused across grid resize');
 assert.equal(f.created.length,afterFirst,'irradiance rebuild on same device must not recreate layouts or compute pipelines');
 f.context.device=f.device();
 f.rebuild();
 f.context.ensureFireIrradianceResources();
 assert.notEqual(f.context.irradianceSeedPipeline,seed32,'replacement device gets fresh irradiance pipelines');
});
test('companion GPU factories reuse shaders, layouts, and compute pipelines on the same device across grid resizes',()=>{
 const f=fixture();
 const dev1=f.device();
 const sharedModule={name:'shared-volume-module'};
 const stubBuffer={kind:'buffer',destroy(){}};
 const stubTexture={kind:'texture',createView:()=>({kind:'view'}),destroy(){}};
 const runAll=(dev,size)=>{
  const dims=[size,size,size];
  const worldPlan={flowDims:dims,flowCells:size**3,materialDims:dims,materialCells:size**3,pressureDims:dims,pressureCells:size**3,min:[-1,-1,-1],max:[1,1,1],materialPitch:2/size};
  const display=createDisplayReconstruction(dev,sharedModule,stubBuffer,()=>({fluidBuffers:[stubBuffer,stubBuffer],reactantTextures:[stubTexture,stubTexture]}));
  display.ensure(dims,{value:true,scale:1,alignment:'cell',emissionInterpolation:'trilinear',smokeInterpolation:'trilinear'});
  return [
   display,
   createSceneVolumeSource({device:dev,module:sharedModule,uniformBuffer:stubBuffer,fluidBuffers:[stubBuffer,stubBuffer],frontBuffers:[stubBuffer,stubBuffer],getReactantTextures:()=>[stubTexture,stubTexture],grid:size,gridY:size}),
   createScatteredSource(dev,{dimensions:dims,primary:stubTexture,scattering:stubTexture,incident:stubTexture}),
   createGpuSceneSolidProducer(dev,{grid:size,gridHeight:size}),
   createWorldSmoke(dev,worldPlan,[0,0,0]),
   createMaterialHierarchyGPU(dev,worldPlan,'/* world code */'),
   createWorldSeed(dev),
   createFineVelocityGrid(dev,fineGridPlan({materialDims:dims,velocity:size/2,pressure:size/2})),
   createPressureTransfer(dev,pressureResolutionPlan({dims,mode:'half',solver:'converged'})),
   createOpenBoundary(dev,dims,stubTexture),
   createBvhReproject(dev,{geometry:{nodes:new Float32Array(12),triangles:new Float32Array(12),nodeCount:1,triangleCount:1,coverage:{device:dev,texture:stubTexture,revision:1}},nodes:stubBuffer,triangles:stubBuffer}),
   createPreparedSmoke(dev,{nodes:stubBuffer,triangles:stubBuffer,nodeCount:1,source:stubTexture,coarseDimensions:[8,8,8],factor:2}),
   (()=>{const g=createVolumeGather(dev,{geometry:{nodes:new Float32Array(12),triangles:new Float32Array(12),nodeCount:1,triangleCount:1},receivers:[],volumeGrid:8,sourceDimensions:[8,8,8],directions:6,smokeRefinement:1,worldGeometry:true});g.encode({status:'encoded',texture:stubTexture,dimensions:[8,8,8],generation:1,frame:1});return g;})(),
   createSpatialReducer(dev,4,stubTexture),
   (()=>{const s=createFireSmokeShadow(dev,{points:stubTexture,resolution:8,steps:8,count:2,filter:true,mediumResolution:4});s.encode({status:'encoded',texture:stubTexture,dimensions:[size,size,size],generation:1,frame:1},{generation:1,frame:1,count:2});return {destroy:()=>s.dispose()};})(),
   (()=>{const m=createShadowMedium(dev);m.encode(dev.createCommandEncoder(),{status:'encoded',texture:stubTexture,dimensions:[size,size,size],generation:1,frame:1},4);return m;})(),
  ];
 };
 f.created.length=0;
 const firstResources=runAll(dev1,32);
 const firstCreated=f.created.length;
 assert.ok(firstCreated>0,'first allocation creates companion shaders, layouts, and pipelines');
 for(const item of firstResources)item.destroy?.();
 const secondResources=runAll(dev1,48);
 assert.equal(f.created.length,firstCreated,'companion factories must reuse shaders, layouts, and pipelines on the same device when resizing');
 for(const item of secondResources)item.destroy?.();
 const dev2=f.device();
 const thirdResources=runAll(dev2,48);
 assert.equal(f.created.length,firstCreated*2,'a replacement device gets its own companion shaders, layouts, and pipelines');
 for(const item of thirdResources)item.destroy?.();
});
test('wavelet coordinate upload buffers are not retained across fine-velocity or fluid-state destruction',()=>{
 const f=fixture();
 const uploadedBuffers=[];
 const dev={
  ...f.device(),
  queue:{
   writeBuffer(buffer,offset,data){if(data instanceof Float32Array&&data.length>16)uploadedBuffers.push(data);},
   writeTexture(dest,data){if(data instanceof Float32Array&&data.length>16)uploadedBuffers.push(data);},
  },
 };
 const plan=fineGridPlan({materialDims:[32,32,32],velocity:16,pressure:16});
 const fine1=createFineVelocityGrid(dev,plan);
 assert.equal(uploadedBuffers.length,2);
 const firstFineUpload=uploadedBuffers[0];
 assert.ok(firstFineUpload instanceof Float32Array);
 const originalFirstValue=firstFineUpload[0];
 firstFineUpload[0]=-999;
 fine1.destroy();
 const fine2=createFineVelocityGrid(dev,plan);
 assert.equal(uploadedBuffers.length,4);
 assert.notEqual(uploadedBuffers[2],firstFineUpload,'fine-velocity wavelet coordinate buffer must not be retained after destroy()');
 assert.equal(uploadedBuffers[2][0],originalFirstValue,'recreated fine-velocity grid must upload fresh unmutated coordinates');
 fine2.destroy();
 assert.ok(!source.includes('waveletCoordinateCache'),'volume-core must not retain wavelet coordinate Float32Arrays in a persistent cache');
});



test('cold basin initialization does not compile unused root raymarch renderer variants',()=>{
 const f=fixture();f.rebuild();assert.equal(f.created.filter(resource=>resource.kind==='render').length,0,'renderer variants must wait for the selected draw path');
});

test('root render selection handles compile only when submitted and retain device lifetime',()=>{
 const f=fixture();f.rebuild();const count=f.created.length,first=f.context.pipeline;
 const selected=f.context.resolveRenderPipeline(first);assert.equal(f.created.length,count+1);assert.equal(f.context.resolveRenderPipeline(first),selected);assert.equal(f.created.length,count+1);
 assert.equal(selected.descriptor.fragment.entryPoint,'fs');
 f.context.gridSize=48;f.context.gridHeight=96;f.rebuild();assert.equal(f.context.pipeline,first);assert.equal(f.context.resolveRenderPipeline(first),selected);
 f.context.device=f.device();f.rebuild();assert.notEqual(f.context.pipeline,first);assert.notEqual(f.context.resolveRenderPipeline(f.context.pipeline),selected);
 const alreadyCompiled={kind:'render'};assert.equal(f.context.resolveRenderPipeline(alreadyCompiled),alreadyCompiled,'derived scene/depth pipelines pass through unchanged');
});
