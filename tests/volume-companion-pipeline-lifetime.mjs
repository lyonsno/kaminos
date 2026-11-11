// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
function fixture(){
 globalThis.GPUBufferUsage??={STORAGE:128,COPY_SRC:4,COPY_DST:8,UNIFORM:64,MAP_READ:1};globalThis.GPUTextureUsage??={TEXTURE_BINDING:4,STORAGE_BINDING:8,COPY_SRC:1,COPY_DST:2,RENDER_ATTACHMENT:16};globalThis.GPUShaderStage??={VERTEX:1,FRAGMENT:2,COMPUTE:4};
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
 return {created,device};
}
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
});
