// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';

test('sampled 3D texture declarations preserve unsigned, signed and float components',()=>{
  for(const [type,component] of [[THREE.UnsignedIntType,'u32'],[THREE.IntType,'i32'],[THREE.HalfFloatType,'f32']]){
    const texture=new THREE.ExternalTexture({});texture.isData3DTexture=true;texture.type=type;
    texture.format=component==='f32'?THREE.RedFormat:THREE.RedIntegerFormat;
    const context={renderer:{backend:{utils:{getTextureSampleData:()=>({primarySamples:1})}}},
      uniforms:{fragment:[{name:'mask',type:'texture3D',groupNode:{name:'object'},node:{value:texture,gatherNode:null}}]},
      bindingsIndexes:{object:{binding:0,group:0}},isUnfilterable:()=>true,
      getComponentTypeFromTexture:THREE.WGSLNodeBuilder.prototype.getComponentTypeFromTexture};
    const code=THREE.WGSLNodeBuilder.prototype.getUniforms.call(context,'fragment');
    assert.ok(code.includes(`texture_3d<${component}>`),code);
  }
});

const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
test('explicit rejected occupancy remains rejected for subsequent runtime readers',async()=>{
  const method=source.match(/    async sampleSceneCollisionMask\([\s\S]*?\n    },/)[0];
  const snapshot={cells:new Uint8Array(8),counts:[0,0,0,0],valid:false,members:[]};
  const context={sceneSolidGpu:{snapshot:async()=>snapshot},sceneSolidRevisionKey:'r1',gridSize:2,gridHeight:2,
    analyticEmitterDescriptor:{},analyticEmitterDispatch:{},countEmitterChemicalSupport:()=>({fluidSupportCells:0}),
    structuredClone,state:{sceneCollision:{requested:true,effective:'submitted-unverified',backend:'gpu',members:[]}}};
  const api=vm.runInNewContext(`({${method.replace(/,$/,'')}})`,context);
  const result=await api.sampleSceneCollisionMask();
  assert.equal(result.runtime.effective,'off');
  assert.equal(context.state.sceneCollision.effective,'off');
  assert.equal(context.state.sceneCollision.reason,'authored-solid-does-not-intersect-volume');
});

test('unknown GPU population does not become zero solids or a denominator for means',async()=>{
  const body=source.match(/  async function resolvePressureResidualProbe\(\) \{[\s\S]*?\n  }/)[0];
  const partials=new Float32Array([2,2,1,1,4,4,2,2,8,3,0,0]);
  const context={pressureResidualCopyPending:true,pressureResidualMapPending:false,
    pressureResidualReadbackBuffer:{mapAsync:async()=>{},getMappedRange:()=>partials.buffer,unmap(){}},
    pressureResidualMapGeneration:1,pressureResidualWorkgroupCount:1,pressureResidualCopyStep:4,
    pressureResidualCopyFrame:2,pressureResidualCopyCells:8,pressureResidualCopyFluidCells:null,
    pressureResidualCopySolver:{},pressureResidualCopyMeasurement:{},gridSize:2,
    GPUMapMode:{READ:1},PRESSURE_RESIDUAL_MAP_TIMEOUT_MS:1000,PRESSURE_RESIDUAL_MAP_TIMEOUT_ERROR:'timeout',
    PRESSURE_RESIDUAL_FLOATS_PER_WORKGROUP:12,gridHeightForSize:()=>2,residualProfileFromPartials:()=>({}),
    performance,setTimeout,clearTimeout,Float32Array,state:{frameCount:2,pressureSolver:{}}};
  await vm.runInNewContext(`(async()=>{${body};await resolvePressureResidualProbe();})()`,context);
  assert.equal(context.state.pressureSolver.residualError,null);
  const result=context.state.pressureSolver.residual;
  assert.equal(result.fluidCells,null);assert.equal(result.solidCells,null);
  assert.equal(result.compact.before.meanAbs,null);assert.equal(result.vorticity.enstrophyMean,null);
  assert.equal(result.compact.before.sumAbs,2);assert.equal(result.compact.before.maxAbs,2);
  assert.equal(result.compact.meanReduction,2);assert.equal(result.vorticity.enstrophySum,8);
});
