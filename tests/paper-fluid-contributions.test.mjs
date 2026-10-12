import test from 'node:test';
import assert from 'node:assert/strict';
let api={};try{api=await import('../experiments/paper-fluid/contributions.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
function fn(name){assert.equal(typeof api[name],'function',`Missing owner contribution ${name}`);return api[name];}

test('river setup carries physical amount and independent world radius through population changes',()=>{
 const build=fn('paperRiverSetup');
 const a=build({particleCount:36864,referenceParticleCount:36864,pressureRadius:.153});
 const b=build({particleCount:12288,referenceParticleCount:36864,pressureRadius:.153});
 for(const c of [a,b]){
  assert.equal(c.solver.pressureSolver,'ipbf');assert.equal(c.solver.truthScene,'river_playground');
  assert.equal(c.dt,1/60);assert.equal(c.support.truthScene,'river_playground');
  assert.ok(Math.abs(c.solver.ipbfPressureRadiusScale*c.sampling.basePressureRadius-.153)<1e-12);
 }
 assert.equal(a.sampling.representedVolume,b.sampling.representedVolume);
 assert.equal(b.sampling.particleVolume,3*a.sampling.particleVolume);
 assert.throws(()=>build({particleCount:36864,referenceParticleCount:12288}),/reference/i);
 assert.throws(()=>build({pressureRadius:0}),/radius/i);
 assert.throws(()=>build({particleCount:12288.5}),/integer/i);
});
test('finite setup reuses existing box semantics with an explicit timestep and no playground supports',()=>{
 const build=fn('paperBoxSetup');
 const c=build({scene:'dam_break',resolution:16,pressureRadius:.1,dt:1/120});
 assert.equal(c.dt,1/120);assert.equal(c.solver.diagnosticPopulation.fixture,'dam_break');
 assert.equal(c.solver.diagnosticBox.planes.length,6);assert.equal(c.solver.diagnosticDynamics,'pressure_surface');
 assert.equal(c.support.kind,'invisible_box');assert.deepEqual(c.support.box,c.solver.diagnosticBox);
 assert.equal(c.solver.particleCount,16**3);assert.equal(c.sampling.representedVolume,1);
 assert.ok(Math.abs(c.solver.ipbfPressureRadiusScale*c.sampling.basePressureRadius-.1)<1e-12);
 assert.throws(()=>build({dt:.1}),/timestep/);
});
test('derived operation reads actual solver conditions, makes no mutation, and refuses another method',()=>{
 const bind=fn('bindPaperPressureOperations');let calls=0;
 const state={available:true,particleVolume:.00016631376856205766,dt:Math.fround(1/60),generation:2,effectiveGeneration:1,
  requested:{radius:.185,alternativeCompliance:.001},effective:{radius:.153,alternativeCompliance:.001}};
 const solver={available:true,getDebugState:()=>({pressureSolver:'ipbf'}),getPressureControls:()=>structuredClone(state)};
 const ops=bind({getSolver:()=>solver,applyPressure:patch=>{calls++;return patch;}});
 const before=structuredClone(state),reference=ops.deriveSoftness();
 assert.equal(reference.radius,.185);assert.equal(reference.inputGeneration,2);assert.equal(reference.inputApplication,'pending');
 assert.deepEqual(state,before);assert.equal(calls,0);assert.ok(reference.brackets[1].alternativeCompliance>100);
 assert.deepEqual(ops.apply({alternativeCompliance:125}),{alternativeCompliance:125});assert.equal(calls,1);
 assert.throws(()=>bind({getSolver:()=>({...solver,getDebugState:()=>({pressureSolver:'pbf'})}),applyPressure(){}}).deriveSoftness(),/IPBF/);
});

test('world-radius control uses the producer conversion and explicit damping linkage',()=>{
 const bind=fn('bindPaperPressureOperations');let patch;
 const state={available:true,particleVolume:.00016631376856205766,dt:Math.fround(1/60),generation:0,effectiveGeneration:0,
  requested:{radius:.185,pressureRadiusScale:1,beta:60,alternativeCompliance:.001},effective:{radius:.185}};
 const solver={available:true,getDebugState:()=>({pressureSolver:'ipbf'}),getPressureControls:()=>structuredClone(state)};
 const ops=bind({getSolver:()=>solver,applyPressure:value=>{patch=value;return {requested:value,generation:1,effectiveGeneration:0};}});
 assert.equal(typeof ops.edit,'function','Owner control conversion missing');
 const result=ops.edit('pressureRadius',.0925,{linkDamping:true});
 assert.deepEqual(patch,{pressureRadiusScale:.5,beta:120});assert.equal(result.effectiveGeneration,0);
 ops.edit('pressureRadius',.0925,{linkDamping:false});assert.equal(patch.beta,60);
 ops.edit('alternativeCompliance',125);assert.deepEqual(patch,{alternativeCompliance:125});
 assert.throws(()=>ops.edit('unknown',1),/control/);
 const reference=ops.deriveSoftness();assert.equal(ops.referenceCurrent(reference),true);
 state.requested.radius=.153;assert.equal(ops.referenceCurrent(reference),false);
 assert.ok(ops.controls.some(x=>x.id==='pressureRadius'&&x.units==='world distance'));
 assert.ok(ops.controls.some(x=>x.id==='alternativeCompliance'&&x.scale==='logarithmic'));
});
