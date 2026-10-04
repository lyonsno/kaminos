import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createFingerFluidSolverGpuTimingStagePlan as plan} from '../finger-fluid-webgpu-core.js';
assert.equal(plan(3, true).length, 25, 'packed timing must separate construction from linked grid build');
assert.equal(plan(3, false).length, 22);
assert.throws(()=>plan(3, 'true'), /boolean/);
const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
const step=source.slice(source.indexOf('  function step(dt ='), source.indexOf('\n  function render({',source.indexOf('  function step(dt =')));
// Execute the actual encoder scheduling body against a recording device, not a second schedule.
for (const packed of [false,true]) for (const timed of [false,true]) {
 const passes=[]; const stages=plan(3,packed);
 const ctx={performance:{now:()=>0},runtimeLifecycle:{stopped:false},clamp:x=>x,finite:x=>x,
 safeSubsteps:1,safeDensityIterations:3,safePackedDensity:packed,safeParticleCount:16,GRID_CELL_COUNT:8,
 writeSimulationParams:()=>{},computeBindGroup:{},KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE:'test',
 pipelines:new Proxy({}, {get:(_,key)=>key}),energyPipelines:{},dispatchEnergy:()=>{},
 dispatch:(pass,pipeline)=>pass.ops.push(pipeline),createFingerFluidSolverTimestampWrites:(_,i)=>({i}),
 solverGpuTimestampCapture:null,solverStageGpuTimestampCapture:timed?{writtenPairs:0,pairCount:1,firstQueryIndex:0,queriesPerStep:stages.length*2,stages,querySet:{}}:null,
 safeChemistryDiffusion:0,safeUnsupportedSheetStrength:0,safeAdaptiveDensity:false,safeParticleShiftStrength:0,VORTICITY_UPDATE_INTERVAL:2,frameIndex:1,
 linkedCellGridBuildCount:0,densityIterationCount:0,postProjectionGridRefreshCount:0,topologyMeasurementPassCount:0,chemistryDiffusionPassCount:0,freeSurfaceClassificationPassCount:0,vorticityPassCount:0,sheetSupportPassCount:0,surfaceCohesionPassCount:0,interfaceCompactionPassCount:0,liquidFireContactCompactionPassCount:0,particleShiftPassCount:0,adaptiveDensityPassCount:0,stepCount:0,lastFrameCpuMs:0,
 device:{queue:{submit:()=>{}},createCommandEncoder:()=>({beginComputePass:d=>{const p={...d,ops:[],setBindGroup:()=>{},setPipeline:x=>p.ops.push(x),dispatchWorkgroups:()=>{},end:()=>{}};passes.push(p);return p},finish:()=>({})})}};
 vm.runInNewContext(step+'\nstep();',ctx);
 const expected=['predict'];
 for(let i=0;i<3;i++)expected.push('clear','build',...(packed?['packedScan','packedTotals','packedRecords']:[]),'lambda','delta','applyDelta');
 expected.push('clear','build','measureTopology','classifySurface','velocity','cohesion','applyVelocity','clearInterface','compactInterface','clearLiquidFireContacts','compactLiquidFireContacts','finalizeLiquidFireContacts');
 assert.deepEqual(passes.flatMap(p=>p.ops),expected,'timestamping preserves complete dispatch order');
 assert.equal(passes.length,timed?stages.length:1,'ordinary solver stays one compute pass');
 if(timed){assert.deepEqual(passes.map(p=>p.label.split(':')[1]),stages);assert.ok(passes.every(p=>p.ops.length));
  for(let i=0;i<3;i++){
   const at=name=>passes.find(p=>p.label===`test:density_iteration_${i}_${name}`).ops;
   assert.deepEqual(at('build_grid'),['build']);assert.deepEqual(at('lambda'),['lambda']);assert.deepEqual(at('position_delta'),['delta']);
   if(packed)assert.deepEqual(at('pack_neighbors'),['packedScan','packedTotals','packedRecords']);
  }
 }
}
console.log('packed density stage timing scheduling passed');
