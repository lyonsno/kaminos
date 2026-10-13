import test from 'node:test';
import assert from 'node:assert/strict';
let setup,createWindow;
try{({pressureLaunchSetup:setup,createObservedRunWindow:createWindow}=await import('../experiments/paper-fluid/pressure-launch.mjs'));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('preview carries the exact coarse drop and explicit actual main compliance',()=>{
 assert.equal(typeof setup,'function','Pressure-launch setup unavailable');
 const a=setup({compliance:0}),b=setup({compliance:6.151275623129607});
 assert.equal(a.solver.particleCount,1209);assert.deepEqual(a.solver.diagnosticPopulation.particleData,b.solver.diagnosticPopulation.particleData);
 assert.equal(a.solver.ipbfCompliance,0);assert.equal(b.solver.ipbfCompliance,6.151275623129607);
 assert.equal(a.solver.ipbfDamping,false);assert.equal(a.solver.capillaryStrength,0);assert.equal(a.solver.densityIterations,4);assert.equal(a.dt,1/60);
 assert.throws(()=>setup({compliance:NaN}),/compliance/);
});
function fixture(){
 let step=0,paused=true,next=0;const frames=new Map(),timers=new Map(),events=[];
 const controller=createWindow({read:()=>({clock:{available:true,generation:1,step,paused}}),pause:value=>{paused=value;},record:e=>events.push(e),
  requestFrame:fn=>{frames.set(++next,fn);return next;},cancelFrame:id=>frames.delete(id),setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
 return{controller,events,frames,timers,get paused(){return paused;},tick(value){step=value;for(const [id,fn]of [...frames]){frames.delete(id);fn();}}};
}
test('explicit interval starts paused, stops on the actual shared clock and cleans callbacks',()=>{
 assert.equal(typeof createWindow,'function','Observed run window unavailable');const f=fixture();assert.equal(f.paused,true);
 f.controller.run({steps:12,maxWallSeconds:30});assert.equal(f.paused,false);f.tick(11);assert.equal(f.paused,false);f.tick(12);assert.equal(f.paused,true);
 assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(f.events.at(-1).effective.endStep,12);assert.equal(f.events.at(-1).effective.reason,'interval-complete');
});
test('deadline, manual stop and disposal pause owned water and do not leave a run armed',()=>{
 assert.equal(typeof createWindow,'function','Observed run window unavailable');const f=fixture();
 f.controller.run({steps:120,maxWallSeconds:30});[...f.timers.values()][0]();assert.equal(f.paused,true);assert.equal(f.events.at(-1).effective.reason,'wall-budget');
 f.controller.run({steps:120,maxWallSeconds:30});f.controller.stop('inactive-document');assert.equal(f.paused,true);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
 f.controller.dispose();assert.throws(()=>f.controller.run({steps:2,maxWallSeconds:30}),/disposed/);
});


// The real URL restoration seam runs before host allocation; our fake host
// reports those resulting values through the observed native debug schema.
test('fixed preview refuses actual matching-owner replay drift and releases its paused water',async()=>{
 const {pressureLaunchExperiment}=await import('../experiments/paper-fluid/pressure-launch.mjs');
 const {restoreOwnerFluidReplay}=await import('../fluid-owner-host.mjs');
 const win={requestAnimationFrame(){return 1;},cancelAnimationFrame(){},setTimeout(){return 2;},clearTimeout(){}};
 function hostFor(extra){let disposes=0;const host={controls:{document:{defaultView:win}},fluid:{async open(s){
  const actual=restoreOwnerFluidReplay(s,new URLSearchParams('experiment=paper%2Fpressure-launch&experiment_inputs=%7B%22compliance%22%3A0%7D&'+extra),{id:'paper/pressure-launch',inputs:{compliance:0}});
  return{read:()=>({clock:{available:true,generation:1,step:0,paused:true,fixedTimeStepSeconds:actual.dt},runtime:{pressureSolver:actual.solver.pressureSolver,particleCount:actual.solver.particleCount,densityIterationsPerStep:actual.solver.densityIterations,capillaryStrength:actual.solver.capillaryStrength,substeps:actual.solver.substeps,ipbfSettings:{compliance:actual.solver.ipbfCompliance,damping:actual.solver.ipbfDamping,radius:actual.solver.ipbfPressureRadiusScale*actual.sampling.basePressureRadius,particleVolume:actual.sampling.particleVolume}}}),setPaused(){},dispose:async()=>disposes++};
 }}};return{host,get disposes(){return disposes;}};}
 for(const extra of ['finger_fluid_density_iterations=7','finger_fluid_capillary_strength=0.19','finger_fluid_ipbf_pressure_radius_scale=2']){
  const h=hostFor(extra);await assert.rejects(pressureLaunchExperiment.create({host:h.host,inputs:{compliance:0},record(){}}),/Fixed pressure preview configuration mismatch/);assert.equal(h.disposes,1);
 }
 const clean=hostFor(''),instance=await pressureLaunchExperiment.create({host:clean.host,inputs:{compliance:0},record(){}});
 assert.equal(instance.read().runtime.densityIterationsPerStep,4);await instance.dispose();assert.equal(clean.disposes,1);
 const compatible=hostFor('finger_fluid_density_iterations=4&finger_fluid_capillary_strength=0&finger_fluid_ipbf_pressure_radius_scale='+(.125/.185));
 const reopened=await pressureLaunchExperiment.create({host:compatible.host,inputs:{compliance:0},record(){}});await reopened.dispose();assert.equal(compatible.disposes,1);
});
