import assert from 'node:assert/strict';
import definition from '../experiments/lazarus-fluid/finite-pbf.experiment.mjs';
import {restoreOwnerFluidReplay} from '../fluid-owner-host.mjs';
const params=new URLSearchParams('experiment=lazarus%2Ffinite-pbf&experiment_inputs=%7B%7D&finger_fluid_capillary_strength=.48&finger_fluid_density_iterations=3');
let generation=0;
const host={fluid:{async open(setup,options={}){
 const actual=options.restoreReplay===false?setup:restoreOwnerFluidReplay(setup,params,{id:definition.id,inputs:{}});let effective={capillaryStrength:actual.solver.capillaryStrength,densityIterations:actual.solver.densityIterations,particleRepulsionStrength:actual.solver.particleRepulsionStrength,freeFlightViscosityBoost:actual.solver.freeFlightViscosityBoost};generation++;
 return {read:()=>({clock:{generation,available:true,paused:true,step:0},controls:{requested:effective,effective},runtime:{pressureSolver:'pbf'}}),applyMaterial(patch){effective={...effective,...patch};return {effective};},setPaused(){},advanceTo(){},restart(){},dispose(){}};
}},controls:{}};
const instance=await definition.create({host,inputs:{},record(){}});await instance.operations.material({capillaryStrength:.4,densityIterations:6});await instance.operations.reset({scene:'dam_break'});const r=instance.read();assert.equal(r.water.controls.effective.capillaryStrength,r.settings.capillaryStrength,'Owner reset must preserve current material instead of stale URL');assert.equal(r.water.controls.effective.densityIterations,6);console.log('Actual owner material/reset honors canonical owner inputs');
