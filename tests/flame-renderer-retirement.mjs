// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as volume from '../volume-core.js';

test('retired flame boundary-splat renderer has no executable public API',()=>{
 const retired=['resolveBoundarySplatExecutionPlan','boundarySplatCapacityLimitReceipt','boundarySplatAllocateInstanceTiers','auditBoundarySplatNestedResidency','classifyBoundarySplatUnionCell','composeBoundarySplatOpticalLayers'];
 assert.deepEqual(retired.filter(name=>typeof volume[name]==='function'),[], 'retired flame renderer remains executable');
 assert.equal(typeof volume.createKaminosVolumePrototype,'function');
});

test('retired renderer options are removed before they can influence current simulation and optical controls',()=>{
 const obsolete={boundarySplatMode:'kernel_moment_covariance',boundarySplatFeatureCapture:true,boundarySplatRadius:3,boundarySplatRadianceGain:10,boundarySplatOpacityGain:9,flowKernelDescriptorCapture:true,volumeResidualMode:'webgpu-direct-residual',volumeResidualModelUrl:'old-model.json',volumeResidualStrength:2,volumeResidualFeatureDebug:1};
 const active={resolution:8,boundarySidecarSource:'baked',reactionLaw:'reactant-v0',opticalParticleSettings:{enabled:true,exchangeStrength:1}};
 const input={...active,...obsolete},before=structuredClone(input);
 const result=volume.stripRetiredRaymarchControls(input);
 assert.deepEqual(result.controls,active,'retired options must leave the effective runtime control set');
 assert.deepEqual(input,before,'reading an old preset must not mutate its source');
 assert.deepEqual(new Map(result.retiredRaymarchControls.map(row=>[row.key,row.value])),new Map(Object.entries(obsolete)),'retirement remains visible in the existing compatibility receipt');
});

import {readFileSync} from 'node:fs';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
test('ordinary volume uniform packing survives removal of the selective composition owner',()=>{
 const start=core.indexOf('    uniforms[312] ='),end=core.indexOf('    const scalarActivityReceiver =',start);
 const uniforms=new Float32Array(400);
 new Function('uniforms','boundarySidecarViewName','boundarySidecarViewValue',core.slice(start,end))(uniforms,'off',()=>0);
 assert.equal(uniforms[317],1);assert.equal(uniforms[318],0);
});
test('ordinary emissive color admission stays on after old residual and splat routes leave',()=>{
 const start=core.indexOf('    const ordinaryEmissiveRoute ='),end=core.indexOf('    uniforms[369] =',start);
 const uniforms=new Float32Array(400),args={productFrameOwner:'prototype',volumePresentationModeEffective:'beauty',uniforms,appearanceDecompositionActive:()=>false,physicalColorRequested:true,physicalColorMode:2,fireRenderModeName:'inspect',boundaryFireInspectActive:true};
 new Function(...Object.keys(args),core.slice(start,end))(...Object.values(args));assert.equal(uniforms[368],2);
});
test('the retained baked boundary field dispatches without the retired splat execution plan',()=>{
 const start=core.indexOf('  function encodeBoundarySidecar('),end=core.indexOf('\n  function timestampQueriesAvailable',start);
 let dispatches=0;const state={frameCount:1,boundarySidecarFrameCount:0};
 const args={resolveBoundaryFieldExecutionPlan:volume.resolveBoundaryFieldExecutionPlan,debugOpticalStepping:{mode:'numerical'},controlsSnapshot:{boundarySidecarSource:'baked'},normalizeBoundarySidecarSource:x=>x,normalizeBoundarySidecarView:()=> 'off',state,gridSize:8,gridHeight:12,BOUNDARY_SIDECAR_BAKE_AUTHORITY:'baked',BOUNDARY_SIDECAR_IDENTITY:'baked',boundarySidecarBuildPipeline:{},boundarySidecarWriteBindGroup:{},boundarySidecarReadBindGroups:[{},{}],currentFluid:0,boundarySidecarDebug:()=>({}),updateSimCostLedger(){},gpuPipelines:{resolve:p=>p}};
 const encode=new Function(...Object.keys(args),core.slice(start,end)+';return encodeBoundarySidecar;')(...Object.values(args));
 encode({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){dispatches++;},end(){}})});
 assert.equal(dispatches,1);assert.equal(state.boundarySidecarBuilt,true);
});

test('full-field materialization depends on its retained baked field',()=>{
 assert.equal(volume.validateFullFieldDerivedBufferMaterialization({boundarySidecarBuilt:false}).ok,false);
 assert.deepEqual(volume.validateFullFieldDerivedBufferMaterialization({boundarySidecarBuilt:true}),{ok:true,failurePhase:null,reason:null});
});

test('numerical flame guidance remains a consumer of the field even with live appearance support',()=>{
 const start=core.indexOf('  function encodeBoundarySidecar('),end=core.indexOf('\n  function timestampQueriesAvailable',start);
 let dispatched=0;
 const args={controlsSnapshot:{boundarySidecarSource:'live',flamePriority:1},debugOpticalStepping:{mode:'numerical'},normalizeBoundarySidecarSource:x=>x,normalizeBoundarySidecarView:()=> 'off',state:{frameCount:1,boundarySidecarFrameCount:0},gridSize:8,gridHeight:12,BOUNDARY_SIDECAR_BAKE_AUTHORITY:'baked',BOUNDARY_SIDECAR_IDENTITY:'baked',FULL_FIELD_DEBUG_EXPORT_SIDECAR_CONSUMER:'export',boundarySidecarBuildPipeline:{},boundarySidecarWriteBindGroup:{},boundarySidecarReadBindGroups:[{},{}],currentFluid:0,boundarySidecarDebug:()=>({}),updateSimCostLedger(){},gpuPipelines:{resolve:p=>p},resolveBoundaryFieldExecutionPlan:volume.resolveBoundaryFieldExecutionPlan};
 const encode=new Function(...Object.keys(args),core.slice(start,end)+';return encodeBoundarySidecar;')(...Object.values(args));
 encode({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){dispatched++;},end(){}})});assert.equal(dispatched,1);
});
