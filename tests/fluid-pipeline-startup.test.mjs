// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
const start=source.indexOf('  const pipelineFor = entryPoint =>'),end=source.indexOf('  let computeBindGroup;',start);
const pending=[];const context={useIPBF:false,useAkinci:false,computeModule:{},computePipelineLayout:{},effectiveLiquidFireContactCoverage:'active-liquid-particles',KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE:'test',failFingerFluidInitialization:message=>{throw Error(message);},device:{createComputePipelineAsync(spec){return new Promise((resolve,reject)=>pending.push({spec,resolve,reject}));}}};
const operation=vm.runInNewContext('(async()=>{'+source.slice(start,end)+'return pipelines;})()',context);
await Promise.resolve();
assert.ok(pending.length>20,'Independent solver pipelines must all be submitted before waiting for any compilation');
pending.forEach(p=>p.resolve(p.spec.compute.entryPoint));const pipelines=await operation;
assert.equal(pipelines.velocity,'compute_velocity_viscosity');assert.equal(pipelines.lambda,'compute_density_lambda');
assert.equal(pipelines.compactLiquidFireContacts,'compact_liquid_volume_particles');
// A failed compile must not abandon outstanding compilations during teardown.
pending.length=0;let finished=false;
const failed=vm.runInNewContext('(async()=>{'+source.slice(start,end)+'return pipelines;})()',context).finally(()=>finished=true);
await Promise.resolve();pending[0].reject(Error('deliberate validation failure'));await Promise.resolve();await Promise.resolve();assert.equal(finished,false);
pending.slice(1).forEach(p=>p.resolve(p.spec.compute.entryPoint));await assert.rejects(failed,/deliberate validation failure/);
console.log('Core compiles independent pipelines together and settles all before failure cleanup');
const energyStart=source.indexOf('  let energyPipelines={}'),energyEnd=source.indexOf('  const format = safeHostFrameComposition',energyStart);
let diagnosticWork=0;
const energyContext={energyDiagnosticsEnabled:false,KAMINOS_FINGER_FLUID_ENERGY_LEDGER_CONTRACT:'test',ENERGY_DIAGNOSTICS_SHADER:'',GPUShaderStage:{COMPUTE:4},particleBuffer:{},paramsBuffer:{},energyDiagnosticsBuffer:{},device:new Proxy({},{get:()=>()=>{diagnosticWork++;return {};}}),createSceneShaderModule(){diagnosticWork++;return {};},failFingerFluidInitialization:message=>{throw Error(message);}};
await vm.runInNewContext('(async()=>{'+source.slice(energyStart,energyEnd)+'})()',energyContext);
assert.equal(diagnosticWork,0,'Disabled diagnostics must not construct shaders, layouts, pipelines or bindings');
