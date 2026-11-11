// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {opticalParticleSettings,particleReactionFromSimulation,createOpticalParticles} from '../volume-optical-particles.mjs';
import {resolveReactantCombustionConfig} from '../volume-reactant-combustion.mjs';
import definition from '../experiments/optical-particles.experiment.mjs';
test('particle reaction inherits the resolved simulation model and time values',()=>{
 const config=resolveReactantCombustionConfig({reactionLaw:'reactant-v0',emitterSourceLaw:'immersed-source',reactantMixingTime:7.5,reactantCoolingTime:29,reactantModelOverrides:{heatOfCombustion:4}});
 assert.deepEqual(particleReactionFromSimulation(config),{burnTime:7.5,cooling:29,heatRelease:4,sootYield:config.effective.model.sootYield,smokeLife:config.effective.model.sootRetirementSteps});
 assert.equal(particleReactionFromSimulation(resolveReactantCombustionConfig({reactionLaw:'authored-tall-plume'})),null);
 assert.throws(()=>opticalParticleSettings({spacing:1.5}),/whole number/);assert.throws(()=>opticalParticleSettings({maxAge:-1}),/Invalid/);
});
test('experiment radii preserve the other axis, edits use shared reaction and a replacement runtime is reseated',async()=>{
 const make=()=>{let settings=opticalParticleSettings(),reaction={burnTime:3,cooling:50,heatRelease:6},split={mode:'off'};return {setOpticalParticles(s){settings=opticalParticleSettings({...settings,...s});},opticalParticleSettings:()=>settings,splitIntegralSettings:()=>split,setSplitIntegral:s=>{split=s;},opticalParticleState:()=>({effective:'world-optical-particles',simulationReaction:reaction}),setParticleSimulationReaction:p=>{reaction={...reaction,...p};},resetOpticalParticles(){}};};
 const win={__kaminosVolumePrototype:make()},first=win.__kaminosVolumePrototype;const doc={defaultView:win,getElementById:()=>null};let callback;
 const experiment=await definition.create({host:{controls:{document:doc},scene:{open:async()=>({onFrame:f=>{callback=f;return()=>{};},redraw(){},async dispose(){}})}},record(){},updateInputs(){},inputs:{particles:{radius:.1,stretch:2}}});
 const a=experiment.operations.setRadius({axis:'horizontal',value:.05});assert.equal(a.settings.radius,.05);assert.equal(a.settings.radius*a.settings.stretch,.2);
 const b=experiment.operations.setRadius({axis:'vertical',value:.1});assert.equal(b.settings.radius,.05);assert.equal(b.settings.stretch,2);
 experiment.operations.setOptions({cooling:23});assert.equal(experiment.read().effective.simulationReaction.cooling,23);
 const second=make();win.__kaminosVolumePrototype=second;experiment.read();assert.equal(second.opticalParticleSettings().enabled,true);assert.equal(first.opticalParticleSettings().enabled,false);
 await experiment.dispose();assert.equal(second.opticalParticleSettings().enabled,false);
});
test('explicit reaction tuning roundtrips and fallback edits change particle settings',async()=>{
 let settings=opticalParticleSettings(),writes=[],shared={burnTime:3,cooling:50,heatRelease:6};
 const runtime={opticalParticleSettings:()=>settings,setOpticalParticles:s=>settings=opticalParticleSettings({...settings,...s}),splitIntegralSettings:()=>({mode:'off'}),setSplitIntegral(){},opticalParticleState:()=>({effective:'world-optical-particles',simulationReaction:shared}),setParticleSimulationReaction:p=>{shared={...shared,...p};return shared;}};
 const make=inputs=>definition.create({host:{controls:{document:{defaultView:{__kaminosVolumePrototype:runtime},getElementById:()=>null}},scene:{open:async()=>({onFrame:()=>()=>{},redraw(){},async dispose(){}})}},inputs,record(){},updateInputs:v=>writes.push(structuredClone(v))});
 let ex=await make({simulationReaction:{cooling:23}});assert.equal(shared.cooling,23,'explicit saved reaction tuning applies to shared simulation');
 ex.operations.setReaction({heatRelease:4});assert.equal(writes.at(-1).simulationReaction.heatRelease,4,'reaction edits persist explicit overrides');await ex.dispose();
 shared=null;ex=await make({});ex.operations.setReaction({cooling:17,heatRelease:2});assert.equal(settings.cooling,17,'inactive Reactant law edits particle fallback');assert.equal(ex.read().settings.heatRelease,2);await ex.dispose();
});

import {resolveOpticalStepping,opticalSteppingConfig} from '../volume-optical-native.mjs';
test('Fine-only particle capture is explicit while ordinary fixed-budget admission stays joined',()=>{
 const c=opticalSteppingConfig({mode:'budgeted'});
 assert.equal(resolveOpticalStepping(c,{emissive:true,localSource:true}).value,4);
 assert.equal(resolveOpticalStepping(c,{emissive:true}).reason,'requires-joined-exterior');
 assert.equal(resolveOpticalStepping(c,{emissive:false,localSource:true}).mode,'fallback-fixed');
});

test('source controls roundtrip independently from population and particle target controls',async()=>{
 let particle=opticalParticleSettings(),controls={renderScale:.7,raySteps:8},writes=[];
 const v={opticalParticleSettings:()=>particle,setOpticalParticles:s=>particle=opticalParticleSettings({...particle,...s}),splitIntegralSettings:()=>({mode:'off'}),setSplitIntegral(){},setControls:p=>controls={...controls,...p},opticalParticleState:()=>({simulationReaction:null,sourceRenderScale:controls.renderScale,sourceRaySteps:controls.raySteps})};
 const ex=await definition.create({inputs:{source:{renderScale:.3}},host:{controls:{document:{defaultView:{__kaminosVolumePrototype:v},getElementById:()=>null}},scene:{open:async()=>({onFrame:()=>()=>{},redraw(){},async dispose(){}})}},record(){},updateInputs:v=>writes.push(v)});
 assert.equal(controls.renderScale,.3);ex.operations.setSource({raySteps:16});ex.operations.setOptions({populationWidth:100,populationHeight:200,targetScale:.5,showParticles:false,showRaymarch:true});assert.equal(controls.raySteps,16);assert.equal(particle.populationWidth,100);assert.equal(writes.at(-1).source.renderScale,.3);assert.equal(writes.at(-1).particles.targetScale,.5);await ex.dispose();
});

test('restored source controls survive native full-control events and runtime replacement',async()=>{
 let particle=opticalParticleSettings(),writes=[];const controls=new Map([['volume-render-scale',{value:'.7'}],['volume-steps',{value:'8'}]]);
 const make=()=>{let values={renderScale:.7,raySteps:8};return {opticalParticleSettings:()=>particle,setOpticalParticles:s=>particle=opticalParticleSettings({...particle,...s}),splitIntegralSettings:()=>({mode:'off'}),setSplitIntegral(){},setControls:p=>{values={...values,...p};},opticalParticleState:()=>({simulationReaction:null,sourceRenderScale:values.renderScale,sourceRaySteps:values.raySteps})};};
 const win={Event:class{},__kaminosVolumePrototype:make()};
 const nativeInput=()=>win.__kaminosVolumePrototype.setControls({renderScale:Number(controls.get('volume-render-scale').value),raySteps:Number(controls.get('volume-steps').value)});
 for(const e of controls.values())e.dispatchEvent=nativeInput;
 const ex=await definition.create({inputs:{source:{renderScale:.3,raySteps:16}},host:{controls:{document:{defaultView:win,getElementById:k=>controls.get(k)}},scene:{open:async()=>({onFrame:()=>()=>{},redraw(){},async dispose(){}})}},record(){},updateInputs:v=>writes.push(v)});
 assert.equal(Number(controls.get('volume-render-scale').value),.3,'restored native render scale must match runtime');
 assert.equal(Number(controls.get('volume-steps').value),16);ex.operations.setSource({raySteps:24});nativeInput();assert.equal(ex.read().effective.sourceRenderScale,.3);assert.equal(ex.read().effective.sourceRaySteps,24);
 win.__kaminosVolumePrototype=make();ex.read();nativeInput();assert.equal(ex.read().effective.sourceRenderScale,.3);assert.equal(ex.read().effective.sourceRaySteps,24);assert.equal(writes.at(-1).source.renderScale,.3);await ex.dispose();
});

test('population dispatch capacity is checked before allocation or retained-state mutation',()=>{
 const limit={maxBufferSize:2**30,maxStorageBufferBindingSize:2**30,maxComputeWorkgroupsPerDimension:65535,maxTextureDimension2D:8192};
 const args={limit,renderScale:1,displayWidth:1,displayHeight:1};
 assert.throws(()=>particleResourceBudget(opticalParticleSettings({populationWidth:2048,populationHeight:2048}),args),/dispatch limit/);
 const valid=particleResourceBudget(opticalParticleSettings({populationWidth:64,populationHeight:65535}),args);assert.equal(valid.slots,64*65535);assert.equal(valid.maxCapacity,64*65535);
});
test('invalid particle target edits preserve accepted experiment settings and inputs',async()=>{
 let settings=opticalParticleSettings(),writes=[];
 const runtime={opticalParticleSettings:()=>settings,setOpticalParticles:s=>{if(s.targetScale>1)throw Error('Particle target exceeds device texture dimensions');settings=s;},splitIntegralSettings:()=>({mode:'off'}),setSplitIntegral(){},opticalParticleState:()=>({simulationReaction:null}),};
 const ex=await definition.create({host:{controls:{document:{defaultView:{__kaminosVolumePrototype:runtime},getElementById:()=>null}},scene:{open:async()=>({onFrame:()=>()=>{},redraw(){},async dispose(){}})}},inputs:{particles:{targetScale:1}},record(){},updateInputs:v=>writes.push(v)});
 assert.throws(()=>ex.operations.setOptions({targetScale:2}),/texture dimensions/);assert.equal(ex.read().settings.targetScale,1);assert.equal(settings.targetScale,1);assert.equal(writes.length,0);await ex.dispose();
});

test('measurement options and actual runtime receipt pass through the Workbench operation',async()=>{
 let settings=opticalParticleSettings(),seen;
 const runtime={opticalParticleSettings:()=>settings,setOpticalParticles:s=>settings=opticalParticleSettings({...settings,...s}),splitIntegralSettings:()=>({mode:'off'}),setSplitIntegral(){},opticalParticleState:()=>({simulationReaction:null}),async measureOpticalParticleFrame(options){seen=options;return {ok:true,settledInputs:options.settleInputs,passes:{acquisition:.1}};}};
 const ex=await definition.create({host:{controls:{document:{defaultView:{__kaminosVolumePrototype:runtime},getElementById:()=>null}},scene:{open:async()=>({onFrame:()=>()=>{},redraw(){},async dispose(){}})}},inputs:{},record(){},updateInputs(){}});
 const receipt=await ex.operations.measure({settleInputs:true});assert.deepEqual(seen,{settleInputs:true});assert.equal(receipt.settledInputs,true);assert.deepEqual(ex.read().measurement,receipt);await ex.dispose();
});

import {particleResourceBudget} from '../volume-particle-acquisition.mjs';
import {particleDepthLayout} from '../volume-particle-depth.mjs';
test('depth field budgets use real atlas capacity and reject invalid drafts before rendering',()=>{
 const limit={maxTextureDimension2D:128};
 const s=opticalParticleSettings({depthMode:1,depthSlices:16,depthScale:.5});
 assert.deepEqual(particleDepthLayout(s,{width:32,height:32,limit}),{width:16,height:16,slices:16,columns:4,rows:4,atlasWidth:64,atlasHeight:64,bytes:24608});
 assert.throws(()=>particleDepthLayout({...s,depthSlices:65},{width:32,height:32,limit}),/device texture/);
 for(const values of [{depthMode:3},{depthSlices:0},{depthSlices:1.5},{depthScale:0}])assert.throws(()=>opticalParticleSettings(values),/Invalid/);
 assert.equal(opticalParticleSettings({carriedSmokeGain:.3}).scatteredGain,.3,'legacy light gain survives normalization');
 assert.equal(opticalParticleSettings({carriedSmokeGain:0,scatteredGain:1}).scatteredGain,1,'light and inherited extinction can be independent');
});
