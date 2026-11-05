// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {worldWindAcceleration} from '../volume-world-smoke.mjs';
import {resolveImmersedSourceConfig,immersedSourceWeights,immersedBackWallCells,immersedSourceUniformValues} from '../volume-core.js';
import {IMMERSED_COLLECTION_WGSL} from '../volume-immersed-source-collection-wgsl.mjs';
import {resolveReactantCombustionConfig} from '../volume-reactant-combustion.mjs';
const reference={calibrationMode:'world',simulationWorldScale:2,calibrationMaterialCells:48,calibrationVelocityCells:24};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('world wind is independent of Fine cell count and coverage at a fixed authored scale',()=>{
 for(const grid of [32,48,64])for(const scale of [1,2]){
  const acceleration=worldWindAcceleration({strength:1,speed:1,fineWidth:grid,scale,calibration:{...reference,simulationDomainScale:scale}});
  close(acceleration[0],.024*2/48);
 }
});
test('physical inlet velocity, thickness and requested volume flux survive changes of grid and coverage',()=>{
 for(const grid of [24,48,64])for(const scale of [1,2]){
  const c=resolveImmersedSourceConfig({...reference,simulationDomainScale:scale,emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',pressureSolverIterations:12,immersedSpeed:.08,immersedThickness:1.5,immersedRadius:.2/scale},{grid,gridHeight:grid,worldSource:true});
  assert.equal(c.effective.admitted,true);const h=2*scale/grid;
  close(c.effective.speed*h,.08*2/48);close(c.effective.thickness*h,1.5*2/48);
  close(c.effective.fullFlux*h**3,.08*2/48*Math.PI*.2**2);
 }
});
test('underresolved immersed inlet slabs maintain at least one-cell Partition-of-Unity velocity coupling without overlapping back walls',()=>{
 const ref64={calibrationMode:'world',simulationWorldScale:2,calibrationMaterialCells:64,calibrationVelocityCells:32};
 for(const [material,velocity,scale] of [[64,32,1],[32,16,1],[64,32,2],[96,48,1]]){
  const c=resolveImmersedSourceConfig({...ref64,simulationDomainScale:scale,emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',pressureSolverIterations:12,immersedSpeed:.08,immersedThickness:1.5,immersedRadius:.2/scale,immersedBackWall:1},{grid:material,gridHeight:material,worldSource:true});
  const e=c.effective,ratio=material/velocity;
  const packed=immersedSourceUniformValues(c,{materialPerVelocity:ratio});
  assert.ok(packed[8]>=1,`velocity-lattice slab thickness must be >= 1 cell, got ${packed[8]}`);
  const v={...e,centreCells:e.centreCells.map(x=>x/ratio),radiusCells:e.radiusCells/ratio,thickness:e.thickness/ratio};
  const weights=immersedSourceWeights(v,{grid:velocity,gridHeight:velocity});
  const peak=Math.max(...weights.cells.map(cell=>cell.w));
  assert.ok(peak>=0.5,`coarsened velocity inlet peak weight collapsed to ${peak} at M${material}/V${velocity} scale=${scale}`);
  const wall=new Set(immersedBackWallCells(v,{grid:velocity,gridHeight:velocity}).map(w=>`${w.x},${w.y},${w.z}`));
  for(const cell of weights.cells)assert.equal(wall.has(`${cell.x},${cell.y},${cell.z}`),false,'back wall must not mask positive source weight');
 }
 assert.match(IMMERSED_COLLECTION_WGSL,/let thickness\s*=\s*max\(1\.0,\s*c\.x\s*\/\s*materialPerCell\);/);
});
test('physical diffusivity stays fixed as coverage changes and time conversion remains explicit',()=>{
 for(const grid of [24,48,64])for(const scale of [1,2]){
  const c=resolveReactantCombustionConfig({...reference,simulationDomainScale:scale,reactionLaw:'reactant-v0',emitterSourceLaw:'immersed-source'},{grid,sourceAdmitted:true,transportCommonCharacteristic:true});
  assert.equal(c.effective.admitted,true);close(c.effective.exchangeWeightPerUnitDt*(2*scale/grid)**2,1.5e-4);
 }
});
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {captureWorldCalibration,resolveWorldCalibration} from '../volume-world-calibration.mjs';
test('capture preserves the baseline and its reference survives subsequent detail edits',()=>{
 const saved=captureWorldCalibration({resolution:48,fineVelocity:24},1.7);
 const roundtrip=JSON.parse(JSON.stringify(saved));
 close(resolveWorldCalibration(roundtrip,{grid:48,scale:1.7}).cellGain,1);
 for(const grid of [32,48,49,64]){
  const c=resolveWorldCalibration({...roundtrip,resolution:grid},{grid,scale:3.4});
  close(c.cellGain*2*3.4/grid,3.4/48);
 }
 assert.throws(()=>resolveWorldCalibration({...saved,simulationWorldScale:0}),/positive/);
 assert.throws(()=>resolveWorldCalibration({...saved,calibrationMaterialCells:0}),/reference/);
});
test('normal scene and basin settings retain all calibration references',()=>{
 const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const id of ['volume-calibration-mode','volume-simulation-world-scale','volume-calibration-material-cells','volume-calibration-velocity-cells']){
  assert.ok(schema.controls.some(c=>c.key===id),`schema missing ${id}`);
  assert.ok(html.includes(`id="${id}"`),`DOM missing ${id}`);
 }
});
test('same-step following pose owns world calibration uniforms',()=>{
 const code=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const at=code.indexOf('  function updateUniforms(now) {'),end=code.indexOf('    viewProj.multiplyMatrices(',at);
 const context={controlsSnapshot:reference,gridSize:48,productTransform:{scale:1,translate:[0,0,0]},state:{},uniforms:new Float32Array(8),WORLD_CALIBRATION_UNIFORM_OFFSET:0,resolveWorldCalibration,
  resize(){},sceneSourceFrameConsumer:true,camera:{updateMatrixWorld(){}},normalizeLookFreeze:()=>false,lookFreezeCanPin:()=>false};
 context.prepareFollowingDomain=()=>{context.productTransform.translate=[.25,.5,-.125];};
 vm.runInNewContext(code.slice(at,end)+'}\nupdateUniforms(0)',context);
 assert.deepEqual([...context.uniforms.slice(4,7)],context.productTransform.translate,'reset coordinates must use the domain pose the same step renders');
});

import {createFineVelocityGrid,fineGridPlan} from '../volume-fine-grid.mjs';
test('positive and negative excitation limits retain the same physical magnitude',()=>{
 const code=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const expression=code.match(/let transportedLateralExcitation = clamp\(([^]*?)\n    \);/)[1].replaceAll('vec2<f32>','Number');
 const limit=new Function('transportedLateralDelta','transportedLateralGain','VELOCITY_UNIT_SCALE','calibrationCellGain','clamp',`return clamp(${expression});`);
 for(const grid of [32,64])for(const velocity of [24,48])for(const scale of [1,2])for(const sign of [-1,1]){
  const c=resolveWorldCalibration(reference,{grid,scale});
  close(limit(sign,.24,velocity/grid,()=>c.cellGain,(v,l,h)=>Math.min(h,Math.max(l,v)))*2*scale/velocity,sign*.006*2/48);
 }
});
test('initial wavelet coordinates use the authored wavelength on independent velocity grids',()=>{
 globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8};globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4,COPY_DST:8};
 const uploads=[];const resource=()=>({createView:()=>({}),destroy(){}});
 const device={createBuffer:resource,createTexture:resource,createShaderModule:()=>({}),createComputePipeline:()=>({getBindGroupLayout:()=>({})}),queue:{writeBuffer(){},writeTexture:(_dst,data)=>uploads.push(data.slice())}};
 for(const velocity of [4,8]){
  uploads.length=0;const calibration=resolveWorldCalibration(reference,{grid:16,scale:2});
  const owner=createFineVelocityGrid(device,fineGridPlan({materialDims:[16,16,16],velocity}),128,{calibration,transform:{scale:2,translate:[1,0,0]}});
  const values=uploads[0];
  // Coordinate 0 is the world-space cell center expressed in reference-velocity cells.
  close(values[0],((1+(.5*2/velocity-1)*2)/(reference.simulationWorldScale/2)+1)*24/2);
  close(values[4]-values[0],2*24/velocity);
  owner.destroy();
 }
 delete globalThis.GPUBufferUsage;delete globalThis.GPUTextureUsage;
});

import {checkCalibrationState} from '../tools/world-calibration-check.mjs';
test('native check rejects fallback, stale references and missing state',()=>{
 const expected={width:2,materialCells:32,velocityCells:16,dims:[48,48,48],velocityDims:[24,24,24]};
 const baseline={step:10,worldSteps:10,adaptive:{steps:10}};
 const s={backend:'webgpu:apple gpu',active:true,error:null,step:20,worldSteps:20,adaptive:{steps:20},calibration:{enabled:true,width:2,materialCells:32,velocityCells:16,cellGain:1.5},dims:expected.dims,velocityDims:expected.velocityDims,pose:{scale:1}};
 assert.equal(checkCalibrationState(s,expected,baseline),true);
 for(const patch of [{backend:'fallback'},{step:0},{calibration:null},{calibration:{...s.calibration,materialCells:48}},{dims:[32,32,32]},{error:'GPU failure'}])assert.throws(()=>checkCalibrationState({...s,...patch},expected,baseline));
 for(const patch of [{step:10},{worldSteps:10},{adaptive:{steps:10}},{worldSteps:undefined},{adaptive:undefined}])assert.throws(()=>checkCalibrationState({...s,...patch},expected,baseline),/advance/);
 assert.throws(()=>checkCalibrationState(s,expected),/baseline/);
});
