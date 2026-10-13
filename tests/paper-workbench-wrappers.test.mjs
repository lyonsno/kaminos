import test from 'node:test';
import assert from 'node:assert/strict';
import {loadExperimentContributions,openExperiment} from '../workbench-experiments.mjs';
import {createIPBFPressureControlState} from '../finger-fluid-pressure-controls.mjs';
import {createOwnerWaterCapability,applyFluidOwnerSetup} from '../fluid-owner-host.mjs';
import {createInvestigationRecording} from '../investigation-recording.mjs';
const paths=['river-softness','block-drop','dam-break'];
async function definitions(){
 const modules=[];
 for(const name of paths){try{modules.push({url:name,mod:await import(`../experiments/paper-fluid/${name}.experiment.mjs`)});}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;assert.fail(`Missing owner experiment definition ${name}`);}}
 return loadExperimentContributions(modules.map(m=>m.url),{loadModule:async url=>modules.find(m=>m.url===url).mod});
}
function harness(){
 let starts=0,disposes=0,generation=1,step=0,paused=true,model,setup;
 const host={fluid:{rendererModes:['screen_space_refraction'],async open(s){
  starts++;setup=s;applyFluidOwnerSetup({},s);
  const baseRadius=s.sampling.basePressureRadius;
  model=createIPBFPressureControlState({baseRadius,cohesionModel:'akinci_2013',pressureRadiusScale:s.solver.ipbfPressureRadiusScale,
   beta:s.solver.ipbfDampingBeta,densityIterations:s.solver.densityIterations,capillaryStrength:s.solver.capillaryStrength,
   alternativeCompliance:s.solver.ipbfAlternativeCompliance});
  const state=()=>({available:true,generation,step,paused});
  // The actual host distinguishes stable experiment ownership from solver reset generation.
  return createOwnerWaterCapability({state,identity:()=>1,debug:()=>({pressureSolver:'ipbf',solver_backend:'fixture',dt:s.dt}),
   pressure:()=>({available:true,...model.read(),particleVolume:s.sampling.particleVolume,dt:Math.fround(s.dt)}),
   apply:patch=>model.request(patch),pause:value=>{paused=value;return {paused};},
   advance:target=>{step=target;model.submit(step);return {endStep:target,dt:s.dt};},
   restart:async()=>{generation++;step=0;},dispose:()=>{disposes++;}});
 }} };
 return {host,get model(){return model;},get starts(){return starts;},get setup(){return setup;},get disposes(){return disposes;}};
}
test('file discovery exposes three owner definitions without allocating water',async()=>{
 const defs=await definitions(),h=harness();
 assert.deepEqual(defs.map(d=>d.id),['paper/river-softness','paper/block-drop','paper/dam-break']);
 assert.equal(h.starts,0);
});
test('finite wrapper forwards actual walls/population/timestep and selects shared water rendering explicitly',async()=>{
 const defs=await definitions(),h=harness();
 const instance=await openExperiment(defs[2],{host:h.host,inputs:{resolution:16,pressureRadius:.1,dt:1/120}});
 assert.equal(h.setup.solver.diagnosticPopulation.fixture,'dam_break');assert.equal(h.setup.solver.particleCount,4096);
 assert.equal(h.setup.solver.diagnosticBox.planes.length,6);assert.equal(h.setup.dt,1/120);
 assert.equal(h.setup.solver.rendererMode,'screen_space_refraction');assert.equal(h.setup.support.kind,'invisible_box');
 assert.ok(Math.abs(h.setup.solver.ipbfPressureRadiusScale*h.setup.sampling.basePressureRadius-.1)<1e-12);
 assert.equal((await instance.read()).initialSetup.dt,1/120);
 await instance.dispose();await instance.dispose();assert.equal(h.disposes,1);
});
test('recorded owner edit distinguishes pending/applied, and range derives without changing water',async()=>{
 const defs=await definitions(),h=harness(),recording=createInvestigationRecording({id:'wrapper',source:{kind:'fixture'},initial:{},startingConditions:{kind:'fixture'}});
 const instance=await openExperiment(defs[0],{host:h.host});
 const request=await instance.invoke('edit',{id:'alternativeCompliance',value:125});
 assert.equal(request.generation,1);assert.equal(request.effectiveGeneration,0);
 let before=await instance.read();const range=await instance.invoke('deriveRange');
 assert.deepEqual((await instance.read()).clock,before.clock);assert.equal(range.inputApplication,'pending');
 await instance.invoke('advance',1);const after=await instance.read();assert.equal(after.controls.effective.alternativeCompliance,125);
 await instance.invoke('restart');assert.equal((await instance.read()).clock.generation,2);
 const events=recording.finish().operations;
 assert.ok(events.some(e=>e.kind==='paper.fluid.edit'&&e.phase==='requested'&&e.requested.alternativeCompliance===125));
 assert.ok(events.some(e=>e.kind==='paper.fluid.range'&&e.effective.inputApplication==='pending'));
 assert.ok(events.some(e=>e.kind==='paper.fluid.advance'&&e.phase==='applied'));
 await instance.dispose();
});
test('invalid setup fails before opening and post-open capability failure releases allocated water',async()=>{
 const defs=await definitions(),h=harness();
 await assert.rejects(openExperiment(defs[0],{host:h.host,inputs:{pressureRaduis:.1}}),/Unknown.*pressureRaduis/);
 await assert.rejects(openExperiment(defs[1],{host:h.host,inputs:{dt:.1}}),/timestep/);assert.equal(h.starts,0);
 let disposes=0;
 await assert.rejects(openExperiment(defs[0],{host:{fluid:{rendererModes:['screen_space_refraction'],open:async()=>({getSolver:()=>({available:false}),dispose:async()=>disposes++})}}}),/capability|IPBF|operation/i);
 assert.equal(disposes,1);
});
test('mounted reference uses the shared operation and remains a recorded observation after external edits',async()=>{
 const defs=await definitions(),h=harness(),instance=await openExperiment(defs[0],{host:h.host});
 const make=tag=>({tag,children:[],listeners:new Map(),attributes:{},append(...nodes){this.children.push(...nodes);},
  setAttribute(key,value){this.attributes[key]=value;},addEventListener(key,value){this.listeners.set(key,value);},
  removeEventListener(key,value){if(this.listeners.get(key)===value)this.listeners.delete(key);},remove(){this.removed=true;}});
 const root=make('root'),document={createElement:make};
 const mounted=await instance.mount({root,document});
 const section=root.children[0],button=section.children.find(e=>e.tag==='button'),output=section.children.find(e=>e.tag==='output');
 assert.match(output.textContent,/No pressure reference/);
 await button.listeners.get('click')();
 assert.match(output.textContent,/Recorded reference/);
 assert.doesNotMatch(output.textContent,/Current reference/);
 assert.ok((await instance.read()).reference.current);
 h.model.request({alternativeCompliance:125});
 assert.equal((await instance.read()).reference.current,false);
 assert.doesNotMatch(output.textContent,/Current reference/,'no cached claim of freshness');
 mounted.dispose();assert.equal(section.removed,true);assert.equal(button.listeners.size,0);
 await instance.dispose();
});
