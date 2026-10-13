import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {paperBoxSetup,paperRiverSetup} from '../experiments/paper-fluid/contributions.mjs';
const path=new URL('../fluid-owner-host.mjs',import.meta.url);
test('owner setup keeps finite population, clock and support together',async()=>{
 assert.ok(fs.existsSync(path),'Shared host owner setup adapter is not implemented');
 const {applyFluidOwnerSetup}=await import(path);
 const setup=paperBoxSetup({resolution:16,dt:1/240});setup.solver.rendererMode='screen_space_refraction';
 const config=applyFluidOwnerSetup({effectiveParticleCount:12288,effectiveTruthScene:'river_playground'},setup);
 assert.equal(config.effectiveParticleCount,4096);assert.equal(config.simulationStepSeconds,1/240);
 assert.equal(config.ownerSetup.solver.diagnosticPopulation,setup.solver.diagnosticPopulation);
 assert.deepEqual(config.ownerSetup.support,setup.support);assert.equal(config.pressureCockpitRequested,true);
 const river=applyFluidOwnerSetup({},paperRiverSetup({particleCount:12288}));assert.equal(river.effectiveTruthScene,'river_playground');assert.equal(river.requestedFixedVolumeReferenceParticleCount,36864);
 assert.throws(()=>applyFluidOwnerSetup({}, {...setup,dt:0}),/timestep/);
});
test('water capability rejects stale generation and preserves producer pressure receipts',async()=>{
 assert.ok(fs.existsSync(path),'Shared generation-bound owner water capability is not implemented');
 const {createOwnerWaterCapability}=await import(path);
 let generation=1,applied=null,disposed=0;
 const state=()=>({available:true,generation,step:3,paused:true});
 const water=createOwnerWaterCapability({state,debug:()=>({pressureSolver:'ipbf'}),pressure:()=>({available:true,requested:{radius:.1}}),apply:p=>(applied=p,{available:true,generation:2,effectiveGeneration:1}),pause:()=>{},advance:()=>{},restart:async()=>{generation++;},dispose:()=>disposed++});
 assert.equal(water.getSolver().getDebugState().pressureSolver,'ipbf');assert.equal(water.applyPressure({beta:60}).effectiveGeneration,1);assert.deepEqual(applied,{beta:60});
 await water.restart();assert.equal(water.read().clock.generation,2);
 generation++;assert.throws(()=>water.applyPressure({beta:10}),/generation/);
 await water.dispose();await water.dispose();assert.equal(disposed,0,'stale disposal must not destroy replacement water');
});

test('shared rendering and timestep refusal are explicit before allocation',async()=>{
 const {applyFluidOwnerSetup}=await import(path);
 assert.throws(()=>applyFluidOwnerSetup({},paperBoxSetup({resolution:16})),/screen_space_refraction/);
 const setup=paperRiverSetup({particleCount:12288});
 assert.throws(()=>applyFluidOwnerSetup({}, {...setup,dt:1/1000}),/step contract/);
});

test('owner identity survives an explicit shared reset and rejects a replaced owner',async()=>{
 const {createOwnerWaterCapability}=await import(path);
 let generation=1,owner=1,disposed=0;
 const water=createOwnerWaterCapability({state:()=>({available:true,generation}),identity:()=>owner,debug:()=>({}),pressure:()=>({}),apply:()=>{},pause:()=>{},advance:()=>{},restart:async()=>generation++,dispose:()=>disposed++});
 generation++;assert.equal(water.read().clock.generation,2,'shared reset reports its new actual generation');
 const restart=water.restart;await restart();assert.equal(water.read().clock.generation,3,'callback does not need a receiver');
 owner++;assert.throws(()=>water.read(),/generation/);await water.dispose();assert.equal(disposed,0);
});
