// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {opticalParticleSettings,particleReactionFromSimulation} from '../volume-optical-particles.mjs';
import {resolveReactantCombustionConfig} from '../volume-reactant-combustion.mjs';
import definition from '../experiments/optical-particles.experiment.mjs';
test('particle reaction inherits the resolved simulation model and time values',()=>{
 const config=resolveReactantCombustionConfig({reactionLaw:'reactant-v0',emitterSourceLaw:'immersed-source',reactantMixingTime:7.5,reactantCoolingTime:29,reactantModelOverrides:{heatOfCombustion:4}});
 assert.deepEqual(particleReactionFromSimulation(config),{burnTime:7.5,cooling:29,heatRelease:4});
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
