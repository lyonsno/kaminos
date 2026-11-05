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
  const fineWall=immersedBackWallCells(e,{grid:material,gridHeight:material,coarseStep:ratio});
  assert.ok(fineWall.length>0,'coarsened back wall must retain solid cells behind the slab');
  const restrictedSolid=new Set(fineWall.map(w=>`${Math.floor(w.x/ratio)},${Math.floor(w.y/ratio)},${Math.floor(w.z/ratio)}`));
  for(const cell of weights.cells)assert.equal(restrictedSolid.has(`${cell.x},${cell.y},${cell.z}`),false,`any-solid-cell restriction of fine back wall must not mask coarse burner cell (${cell.x},${cell.y},${cell.z}) at M${material}/V${velocity}`);
 }
 assert.match(IMMERSED_COLLECTION_WGSL,/let thickness\s*=\s*max\(1\.0,\s*c\.x\s*\/\s*materialPerCell\);/);
});
test('separated pressure projection preserves zero-Neumann delta on coarse-blocked faces and scales speed bounds by world calibration',()=>{
 const code=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const cal=readFileSync(new URL('../volume-world-calibration.mjs',import.meta.url),'utf8');
 const proj=code.slice(code.indexOf('fn csProjectPressureConverged('),code.indexOf('fn pressureResidualReduce('));
 assert.match(proj,/if \(!sceneFaceOpen\(c, 0u\)\) \{ correctedVelocity\.x = select\(0\.0, velocityDensity\.x, SEPARATED_PRESSURE\); \}/);
 assert.match(proj,/if \(!sceneFaceOpen\(c, 1u\)\) \{ correctedVelocity\.y = select\(0\.0, velocityDensity\.y, SEPARATED_PRESSURE\); \}/);
 assert.match(proj,/if \(!sceneFaceOpen\(c, 2u\)\) \{ correctedVelocity\.z = select\(0\.0, velocityDensity\.z, SEPARATED_PRESSURE\); \}/);
 const sep=code.slice(code.indexOf('function encodeSeparatedPressure('),code.indexOf('function encodePressureProjection('));
 assert.match(sep,/velocityScale:\s*\(velocityOwner\?1\/velocityOwner\.plan\.materialPerVelocity:1\)\*calibrationGain/);
 assert.match(sep,/maxSpeed:\s*TRANSPORT_MAX_BACKTRACE_CELLS\s*\/\s*time\.backtraceScale\s*\/\s*\(velocityOwner\?\.plan\.materialPerVelocity\?\?1\)\s*\*\s*calibrationGain/);
 assert.match(cal,/return select\(VELOCITY_UNIT_SCALE,f32\(GRID\)\*u\.world_calibration\.y\/max\(1\.0,u\.world_calibration\.w\),u\.world_calibration\.w>0\.0\);/);
});
test('material predictor caches oxidizer and turbulent characteristic while optical medium seeds gate Hamburger quadrature',()=>{
 const code=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const sceneSource=readFileSync(new URL('../scene-volume-source.mjs',import.meta.url),'utf8');
 const worldOptics=readFileSync(new URL('../volume-world-smoke-optics.mjs',import.meta.url),'utf8');
 const predOx=code.slice(code.indexOf('fn reactantPredictedOxidizer('),code.indexOf('fn sampleReactantPredicted('));
 assert.match(predOx,/fluidPredict\[slotIndex\(c, 0u\)\]\.w/);
 assert.doesNotMatch(predOx,/sampleReactantOxidizer/);
 assert.match(sceneSource,/regionSmokeMaterial\(worldSmokeSample\(p\),vec3<f32>\(0\.0\),1\.0,0\.0\)/);
 assert.match(sceneSource,/regionSmokeMaterial\(regionSmokeSample\(middleOptical,p,worldRender\.middleLoPitch,0\),vec3<f32>\(0\.0\),1\.0,0\.0\)/);
 assert.match(worldOptics,/if\(fireVisible>0\.0&&u\.emissive_physics\.x>\.5&&raw\.x>1e-5&&moments\.x>1e-6\)/);
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
import * as calibrationModule from '../volume-world-calibration.mjs';
import * as worldSmokeModule from '../volume-world-smoke.mjs';
import {MaterialHierarchy,predictDemand,materialImportance} from '../volume-material-hierarchy.mjs';
test('adaptive material demand prediction stays finite for non-multiple-of-4 world material dimensions',()=>{
 for(const n of [10,14,20,28]){
  const dims=[n,n,n];
  const h=new MaterialHierarchy({dims,options:{budget:2,maxDetail:2}});
  const lastRoot=h.roots.at(-1).key;
  const seed=new Map([[lastRoot,{reaction:10,mixing:10,thermal:10,smoke:10,motionMin:[-1,-1,-1],motionMax:[1,1,1]}]]);
  const first=h.allocate(seed);
  assert.ok(first.leaves.length>h.roots.length);
  const leafSignals=new Map(first.leaves.map(l=>[l.key,{reaction:10,mixing:10,thermal:10,smoke:10,motionMin:[-1,-1,-1],motionMax:[1,1,1]}]));
  const predicted=predictDemand(first.nodes,leafSignals,{dims,basePitch:12/n,horizon:12/n});
  for(const [k,sig] of predicted.entries()){
   assert.ok(Number.isFinite(materialImportance(sig)),`non-finite importance at ${k} for dims=${n}`);
  }
  const second=h.allocate(predicted);
  assert.ok(second.leaves.length>=h.roots.length);
 }
});
test('world boxFraction snaps f32 rounding residuals and straddling exterior history is bounded',()=>{
 const smokeSrc=readFileSync(new URL('../volume-world-smoke.mjs',import.meta.url),'utf8');
 const hierGpuSrc=readFileSync(new URL('../volume-material-hierarchy-gpu.mjs',import.meta.url),'utf8');
 assert.match(smokeSrc,/fn boxFraction\(p:vec3<f32>,pitch:f32,lo:vec3<f32>,hi:vec3<f32>\)->f32\{[\s\S]*1\.0-1e-4/);
 assert.match(smokeSrc,/fn clampStraddleExterior\(/);
 assert.match(hierGpuSrc,/clampStraddleExterior\(gasScale\(history,1\.0\/\(1\.0-fraction\)\),totalBack,fg\)/);
});
test('world buoyancy acceleration and diffusivity respect simulation world scale and fine transform scale',()=>{
 assert.equal(typeof worldSmokeModule.worldBuoyancyAcceleration,'function');
 const cal={calibrationMode:'world',simulationWorldScale:4,calibrationMaterialCells:24,calibrationVelocityCells:24};
 for(const fineWidth of [24,32,48])for(const scale of [1,2,4]){
  const b=worldSmokeModule.worldBuoyancyAcceleration({buoyancy:.002,fineWidth,scale,calibration:{...cal,simulationDomainScale:scale}});
  close(b,.002*(4/2)*(32/24));
 }
 const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 assert.doesNotMatch(core,/let heatExpansion = thermalExpansionForce\([^\n]+\) \* calibrationCellGain\(\);/);
});
test('independent simulation levers toggle world emissive material, empty-air fast bypass and separated velocity wavelet',()=>{
 assert.equal(typeof calibrationModule.resolveSimulationLevers,'function');
 const defaults=calibrationModule.resolveSimulationLevers({});
 assert.deepEqual(defaults,{
  worldEmissive:'on',
  worldSmokeOnly:false,
  fastBypass:'off',
  fastBypassEnabled:false,
  velocityWavelet:'off',
  velocityWaveletEnabled:false
 });
 const active=calibrationModule.resolveSimulationLevers({worldEmissive:'off',fastBypass:'on',velocityWavelet:'on'});
 assert.deepEqual(active,{
  worldEmissive:'off',
  worldSmokeOnly:true,
  fastBypass:'on',
  fastBypassEnabled:true,
  velocityWavelet:'on',
  velocityWaveletEnabled:true
 });
 assert.throws(()=>calibrationModule.resolveSimulationLevers({worldEmissive:'maybe'}),/worldEmissive/);
 assert.throws(()=>calibrationModule.resolveSimulationLevers({fastBypass:'maybe'}),/fastBypass/);
 assert.throws(()=>calibrationModule.resolveSimulationLevers({velocityWavelet:'maybe'}),/velocityWavelet/);
 const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const authoring=readFileSync(new URL('../flame-authoring.mjs',import.meta.url),'utf8');
 const gridUi=readFileSync(new URL('../volume-grid-tuning-ui.mjs',import.meta.url),'utf8');
 for(const id of ['volume-world-emissive','volume-fast-bypass','volume-velocity-wavelet']){
  assert.ok(schema.controls.some(c=>c.key===id),`schema missing ${id}`);
  assert.ok(html.includes(`id="${id}"`),`DOM missing ${id}`);
  assert.ok(authoring.includes(`'${id}'`),`Flame Inspector missing ${id}`);
  assert.ok(calibrationModule.SIMULATION_LEVER_FIELDS.some(f=>f.id===id),`SIMULATION_LEVER_FIELDS missing ${id}`);
 }
 assert.match(gridUi,/SIMULATION_LEVER_FIELDS/);
 const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const worldSmoke=readFileSync(new URL('../volume-world-smoke.mjs',import.meta.url),'utf8');
 const hierarchy=readFileSync(new URL('../volume-material-hierarchy-gpu.mjs',import.meta.url),'utf8');
 const worldOptics=readFileSync(new URL('../volume-world-smoke-optics.mjs',import.meta.url),'utf8');
 const worldRender=readFileSync(new URL('../volume-world-render.mjs',import.meta.url),'utf8');
 const emissiveTransport=readFileSync(new URL('../volume-emissive-transport.mjs',import.meta.url),'utf8');
 const sceneSource=readFileSync(new URL('../scene-volume-source.mjs',import.meta.url),'utf8');
 assert.match(core,/fn worldSmokeOnlyOn\(\) -> bool \{\s*return u\.open_world_boundary\.y > 0\.5;\s*\}/);
 assert.match(core,/fn fastBypassOn\(\) -> bool \{\s*return u\.open_world_boundary\.z > 0\.5;\s*\}/);
 assert.match(core,/fn velocityWaveletOn\(\) -> bool \{\s*return u\.open_world_boundary\.w > 0\.5;\s*\}/);
 assert.match(core,/if \(!VELOCITY_ONLY && fastBypassOn\(\) && u\.emissive_physics\.x > 0\.5\)/);
 assert.match(core,/if \(!VELOCITY_ONLY && fastBypassOn\(\) && bypassOutsidePrimitive/);
 assert.match(core,/if \(waveletOn\(\) && VELOCITY_ONLY && velocityWaveletOn\(\)\) \{ vel = vel \+ waveletCorrection\(backCell, velTransported, waveletCoordA, waveletCoordB, timeStep\); \}/);
 assert.match(core,/if\(!MATERIAL_ONLY\|\|!waveletOn\(\)\|\|velocityWaveletOn\(\)\)\{return resolved;\}/);
 assert.match(worldSmoke,/fn worldSmokeOnly\(\)->bool\{return u\.pressureControl\.w>0\.5;\}/);
 assert.match(hierarchy,/let smokeOnly=worldSmokeOnly\(\);/);
 assert.match(worldOptics,/fn fineFlameContainmentEnvelope\(/);
 assert.match(worldRender,/fn worldRenderSmokeOnly\(\)->bool\{return\(u32\(wr\.loMode\.w\)&4u\)!=0u;\}/);
 assert.match(emissiveTransport,/fn fastEmissiveMaterialAt\(/);
 assert.match(sceneSource,/fastEmissiveMaterialAt\(/);
});
test('native check rejects fallback, stale references and missing state',()=>{
 const expected={width:2,materialCells:32,velocityCells:16,dims:[48,48,48],velocityDims:[24,24,24]};
 const baseline={step:10,worldSteps:10,adaptive:{steps:10}};
 const s={backend:'webgpu:apple gpu',active:true,error:null,step:20,worldSteps:20,adaptive:{steps:20},calibration:{enabled:true,width:2,materialCells:32,velocityCells:16,cellGain:1.5},dims:expected.dims,velocityDims:expected.velocityDims,pose:{scale:1}};
 assert.equal(checkCalibrationState(s,expected,baseline),true);
 for(const patch of [{backend:'fallback'},{step:0},{calibration:null},{calibration:{...s.calibration,materialCells:48}},{dims:[32,32,32]},{error:'GPU failure'}])assert.throws(()=>checkCalibrationState({...s,...patch},expected,baseline));
 for(const patch of [{step:10},{worldSteps:10},{adaptive:{steps:10}},{worldSteps:undefined},{adaptive:undefined}])assert.throws(()=>checkCalibrationState({...s,...patch},expected,baseline),/advance/);
 assert.throws(()=>checkCalibrationState(s,expected),/baseline/);
});
