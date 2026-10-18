// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {worldSmokePlan,worldSmokeMapping} from '../volume-world-smoke.mjs';
const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
function grab(name){const start=source.indexOf(`  function ${name}(`);return start<0?'':source.slice(start,source.indexOf('\n  }',start)+4);}
test('world resize never destroys a texture referenced by the pending fine frame',()=>{
  const textures=[],bound=[],anchor={translate:[0,0,0],scale:1};
  const createWorldSmoke=(_device,plan)=>{const optical={destroyed:false};textures.push(optical);return {optical,anchor,encode(){return {flowDims:plan.flowDims,materialDims:plan.materialDims};},destroy(){optical.destroyed=true;}};};
  const oldPlan=worldSmokePlan({flow:16,material:32,extent:3,fineHeightRatio:2});
  const ctx={worldSmoke:createWorldSmoke(null,oldPlan),worldSmokeKey:JSON.stringify(oldPlan),worldSolidProducer:{destroy(){}},worldRenderUniform:{},
    controlsSnapshot:{worldSmoke:'on',worldSmokeFlow:16,worldSmokeMaterial:32,worldSmokeExtent:4},uniforms:{368:2},
    state:{reactantCombustion:{effective:{admitted:true}},simStepCount:1},gridSize:32,gridHeight:64,
    device:{queue:{writeBuffer(){}}},createWorldSmoke,worldSmokePlan,worldSmokeMapping,productTransform:anchor,
    createGpuSceneSolidProducer:()=>({destroy(){}}),getSceneCollision:()=>null,
    rebuildFluidBindGroups(){ctx.group={texture:ctx.worldSmoke.optical};},fluidBindGroup:()=>ctx.group,
    fluidBuffers:[{},{}],reactantTextures:[{},{}],currentFluid:0,currentFront:0,currentQuench:0,
    resolveTimeStepConfig:()=>({effective:{}}),resolvePhysicsAppearance:()=>({}),resolveVelocityStaggeringConfig:()=>({effective:{mode:'cell'}}),
    refreshSceneCollision(){},ensureAppearanceLayout(){},resolveTransportConfig:()=>({effective:{predictorPass:false}}),ensureTransportPredictorBuffer(){},
    computePipeline:{},transportPredictBindGroup:{},encodeAnalyticEmitterInjection(){},encodePressureProjection(){return false;},updateSimCostLedger(){},Float32Array};
  ctx.rebuildFluidBindGroups();vm.createContext(ctx);
  vm.runInContext(['prepareWorldSmoke','encodeWorldSmoke','encodeSim'].map(grab).join('\n'),ctx);
  const encoder={beginComputePass(){return {setPipeline(){},setBindGroup(_i,g){if(g.texture)bound.push(g.texture);},dispatchWorkgroups(){},end(){}};}};
  ctx.encodeSim(encoder);
  assert.equal(textures.length,2,'resize allocates exactly one replacement');
  assert.equal(textures[0].destroyed,true,'superseded allocation is retired');
  assert.ok(bound.length>0,'actual fine pass binds the world texture');
  assert.ok(bound.every(texture=>!texture.destroyed),'pending command buffer must not reference destroyed world optical state');
  ctx.encodeSim(encoder);assert.equal(textures.length,2,'unchanged next frame reuses allocation');
});
