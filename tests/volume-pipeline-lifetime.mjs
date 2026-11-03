// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createEmissiveLightField} from '../volume-emissive-transport.mjs';
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
  limits:{maxStorageBufferBindingSize:2**30,maxBufferSize:2**30,maxComputeWorkgroupsPerDimension:65535,maxTextureDimension3D:2048},
  queue:{writeBuffer(){},writeTexture(){},submit(){},onSubmittedWorkDone:async()=>{}},
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
 const context={
  device:device(),
  fluidPipelineDevice:null,
  fluidPipelineTransparency:null,
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
  scenePointShaders:new Map(),
  distributedShaders:new Map(),
  materialOnlyPipeline:null,
  materialOnlyPredictPipeline:null,
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
 for(const m of block.matchAll(/\b(?:layout|module):\s*([a-zA-Z]\w*)/g))if(!(m[1] in context))context[m[1]]={name:m[1]};
 for(const m of block.matchAll(/\b[A-Z][A-Z_]+\b/g))if(!(m[0] in context))context[m[0]]=m[0];
 for(const name of ['ordinaryDepthPipelines','opticalSteppingPipelines','scenePointPipelines','distributedPipelines'])context[name]=new Map();
 vm.createContext(context);
 vm.runInContext(irradianceBlock,context);
 const rebuild=()=>vm.runInContext(`(()=>{${block}})()`,context);
 const selectRender=(overrides={})=>vm.runInContext(`(()=>{let {drawPipeline=pipeline,targetPipeline=pipeline,multisampled=false,scenePointBindGroup=null,distributedGroup=null,selectEmissive=false}=${JSON.stringify(overrides)};${renderSelectionBlock};return drawPipeline;})()`,context);
 return {context,created,rebuild,selectRender,device};
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
   createEmissiveLightField(dev,sharedModule,stubBuffer,[stubBuffer,stubBuffer],[stubBuffer,stubBuffer],()=>[stubTexture,stubTexture]),
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

