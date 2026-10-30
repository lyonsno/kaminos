// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {worldSmokePlan,worldSmokeMapping} from '../volume-world-smoke.mjs';
import {resolveWorldRegions} from '../volume-region-controls.mjs';
import {pressureResolutionPlan} from '../volume-pressure-resolution.mjs';
const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
function grab(name){const start=source.indexOf(`  function ${name}(`);return start<0?'':source.slice(start,source.indexOf('\n  }',start)+4);}
test('world resize never destroys a texture referenced by the pending fine frame',()=>{
  const textures=[],bound=[],anchor={translate:[0,0,0],scale:1};
  const createWorldSmoke=(_device,plan)=>{const optical={destroyed:false};textures.push(optical);return {optical,anchor,encode(){return {flowDims:plan.flowDims,materialDims:plan.materialDims};},destroy(){optical.destroyed=true;}};};
  const oldPlan=worldSmokePlan({flow:16,material:32,extent:3,fineHeightRatio:2});
  const ctx={adaptiveMaterialOptions:null,adaptiveMaterialError:null,intermediateFlow:null,intermediateSolidProducer:null,intermediateKey:null,worldSmoke:createWorldSmoke(null,oldPlan),worldSmokeKey:JSON.stringify(oldPlan),worldSolidProducer:{destroy(){}},worldRenderUniform:{},
    controlsSnapshot:{worldSmoke:'on',worldSmokeFlow:16,worldSmokeMaterial:32,worldSmokeExtent:4},uniforms:new Float32Array(512),uniformBuffer:{},OPEN_WORLD_UNIFORM_OFFSET:472,
    resolvePressureSolverConfig:()=>({effective:{solver:'converged'}}),PRESSURE_SOLVER_CONVERGED:'converged',IMMERSED_SOURCE_LAW:'immersed-source',
    encodeFollowingDomain(){},encodeGpuThermalConsumer(){},gpuThermalConsumer:null,prepareFineVelocity(){return null;},
    state:{reactantCombustion:{effective:{admitted:true}},simStepCount:1},gridSize:32,gridHeight:64,
    device:{queue:{writeBuffer(){}}},createWorldSmoke,resolveWorldRegions,worldSmokeMapping,productTransform:anchor,
    createGpuSceneSolidProducer:()=>({destroy(){}}),getSceneCollision:()=>null,
    rebuildFluidBindGroups(){ctx.group={texture:ctx.worldSmoke.optical};},fluidBindGroup:()=>ctx.group,
    fluidBuffers:[{},{}],reactantTextures:[{},{}],currentFluid:0,currentFront:0,currentQuench:0,
    resolveTimeStepConfig:()=>({effective:{}}),resolvePhysicsAppearance:()=>({}),resolveVelocityStaggeringConfig:()=>({effective:{mode:'cell'}}),
    refreshSceneCollision(){},ensureAppearanceLayout(){},resolveTransportConfig:()=>({effective:{predictorPass:false}}),ensureTransportPredictorBuffer(){},
    computePipeline:{},transportPredictBindGroup:{},encodeAnalyticEmitterInjection(){},encodePressureProjection(){return false;},updateSimCostLedger(){},Float32Array};
  ctx.uniforms[368]=2;ctx.rebuildFluidBindGroups();vm.createContext(ctx);
  vm.runInContext(['retireIntermediateFlow','prepareWorldSmoke','encodeWorldSmoke','encodeSim'].map(grab).join('\n'),ctx);
  const encoder={beginComputePass(){return {setPipeline(){},setBindGroup(_i,g){if(g.texture)bound.push(g.texture);},dispatchWorkgroups(){},end(){}};}};
  ctx.encodeSim(encoder);
  assert.equal(textures.length,2,'resize allocates exactly one replacement');
  assert.equal(textures[0].destroyed,true,'superseded allocation is retired');
  assert.ok(bound.length>0,'actual fine pass binds the world texture');
  assert.ok(bound.every(texture=>!texture.destroyed),'pending command buffer must not reference destroyed world optical state');
  ctx.encodeSim(encoder);assert.equal(textures.length,2,'unchanged next frame reuses allocation');
});
test('separated pressure rebinds the current world optical allocation',()=>{
  let optical={destroyed:false};const bound=[];
  const owner={key:'32:64:32:2:material',uniform:{},before:{},after:{},solid:{createView:()=>({})},burn:{},write:{},read:{},residentBytes:0,prepare(){},encode(){}};
  const ctx={pressureResolutionPlan,gridSize:32,gridHeight:64,controlsSnapshot:{pressureResolution:'half'},state:{simStepCount:1},separatedPressure:owner,
    separatedPressureProjectPipeline:{},uniforms:new Float32Array(512),GRID_SHAPE_UNIFORM_OFFSET:0,OPEN_WORLD_UNIFORM_OFFSET:472,joinedLowerFaceTexture:{},device:{queue:{writeBuffer(){}}},
    sceneSolidTexture:{width:32},reactantTextures:[{},{}],frontBuffers:[{},{}],burnRateTexture:{},worldSmoke:{optical},worldOpticalFallback:{},intermediateFlow:null,
    nonRidgeOpticalCaptureRowBuffer:{},sceneSolidTextureView:{},fluidBuffers:[{}],currentFluid:0,
    createFluidRenderBindGroup:()=>({texture:ctx.worldSmoke.optical}),resolveTransportConfig:()=>({effective:{scheme:'maccormack'}}),resolveTimeStepConfig:()=>({effective:{backtraceScale:1}}),TRANSPORT_MAX_BACKTRACE_CELLS:1,
    beginPressureResidualProbe:()=>null,pressureDivergenceWarmPipeline:{},pressureRedBlackEvenPipeline:{},pressureRedBlackOddPipeline:{},updateSimCostLedger(){}};
  vm.createContext(ctx);vm.runInContext(grab('encodeSeparatedPressure'),ctx);
  const encoder={beginComputePass:()=>({setPipeline(){},setBindGroup(i,g){if(i===0)bound.push(g.texture);},dispatchWorkgroups(){},end(){}})};
  const solver={effective:{solver:'converged',iterations:1,openTop:true}};
  ctx.encodeSeparatedPressure(encoder,solver,{});bound.length=0;
  optical.destroyed=true;ctx.worldSmoke={optical:{destroyed:false}};
  ctx.encodeSeparatedPressure(encoder,solver,{});
  assert.equal(bound.length,4);
  assert.ok(bound.every(texture=>texture===ctx.worldSmoke.optical&&!texture.destroyed),'pressure passes must not retain the replaced optical allocation');
});

test('world resize keeps ordinary transport available when adaptive capacity is no longer admitted',()=>{
  const ctx={adaptiveMaterialOptions:{budget:100},adaptiveMaterialError:null,worldSmoke:null,worldSmokeKey:null,worldSolidProducer:null,
    intermediateFlow:null,intermediateSolidProducer:null,intermediateKey:null,worldRenderUniform:{},
    controlsSnapshot:{worldSmoke:'on',worldSmokeFlow:8,worldSmokeMaterial:16,worldSmokeExtent:3},uniforms:new Float32Array(512),uniformBuffer:{},OPEN_WORLD_UNIFORM_OFFSET:472,
    state:{reactantCombustion:{effective:{admitted:true}}},gridSize:32,gridHeight:64,
    device:{queue:{writeBuffer(){}}},resolveWorldRegions,productTransform:{translate:[0,0,0],scale:1},
    resolvePressureSolverConfig:()=>({effective:{solver:'converged'}}),PRESSURE_SOLVER_CONVERGED:'converged',IMMERSED_SOURCE_LAW:'immersed-source',
    createGpuSceneSolidProducer:()=>({destroy(){}}),rebuildFluidBindGroups(){},Float32Array,
    createWorldSmoke:()=>({configureAdaptiveMaterial(){throw Error('Material pool exceeds device capacity');},anchor:{translate:[0,0,0],scale:1}})};
  ctx.uniforms[368]=2;vm.createContext(ctx);vm.runInContext(['retireIntermediateFlow','prepareWorldSmoke'].map(grab).join('\n'),ctx);
  assert.doesNotThrow(()=>ctx.prepareWorldSmoke());
  assert.equal(ctx.adaptiveMaterialError,'Material pool exceeds device capacity');
  assert.ok(ctx.worldSmoke,'Ordinary world field remains available after adaptive admission fails');
  assert.equal(ctx.adaptiveMaterialOptions.budget,100,'Requested policy remains visible for correction');
});
