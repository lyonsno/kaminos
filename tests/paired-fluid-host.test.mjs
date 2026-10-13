import test from 'node:test';
import assert from 'node:assert/strict';
import {pressureLaunchSetup} from '../experiments/paper-fluid/pressure-launch.mjs';
import * as host from '../paired-fluid-host.mjs';
const setup=pressureLaunchSetup({compliance:3});
function observed(){return {runtime:{pressureSolver:setup.solver.pressureSolver,particleCount:setup.solver.particleCount,densityIterationsPerStep:4,capillaryStrength:0,substeps:1,stepCount:0,solver_backend:'webgpu',adapterInfo:{isFallbackAdapter:false},ipbfSettings:{compliance:3,damping:false,radius:.125,particleVolume:setup.sampling.particleVolume}},pressure:{dt:Math.fround(setup.dt)}};}
test('pair labels come from validated effective solver settings and retain the native float timestep',()=>{
 assert.equal(typeof host.readPairedFluidArm,'function','effective pair admission missing');
 const value=host.readPairedFluidArm(setup,observed(),{id:'arm-1',generation:2});
 assert.equal(value.settings.compliance,3);assert.equal(value.physicsTimestepSeconds,Math.fround(1/60));assert.equal(value.dt,1/60);
 for(const key of ['particleCount','pressureSolver','substeps']){const bad=observed();delete bad.runtime[key];assert.throws(()=>host.readPairedFluidArm(setup,bad,{}),/configuration mismatch/);}
 const fallback=observed();fallback.runtime.adapterInfo.isFallbackAdapter=true;assert.throws(()=>host.readPairedFluidArm(setup,fallback,{}),/native/);
 const wrong=observed();wrong.pressure.dt=.02;assert.throws(()=>host.readPairedFluidArm(setup,wrong,{}),/timestep/);
});
