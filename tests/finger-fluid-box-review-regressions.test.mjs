import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createFingerFluidBoxReference as fixture} from '../finger-fluid-box-fixtures.mjs';
import {solverSpy} from './helpers/finger-fluid-solver-spy.mjs';
const f=fixture({resolution:24});
assert.equal(f.pressureRadius,undefined,'unused IPBF radius must not impersonate PBF support');
for(const n of [16,24,32,40]){
 const f=fixture({resolution:n}),s=await solverSpy({particleCount:f.particleCount,diagnosticPopulation:f.population,diagnosticBox:f.box,viscosityScaling:'nominal_diffusion',simulationStepSeconds:1/240});
 try{
  const d=s.solver.getDebugState();assert.ok(Math.abs(d.representedPopulationVolume-6012.731288852156)<.001);
  const initial=d.viscosityScaling.factor;s.solver.step(1/240);assert.equal(s.solver.getDebugState().viscosityScaling.factor,initial);
  if(n===24){const shader=s.modules.find(m=>m.code?.includes('fn compute_velocity_viscosity')).code;const r=spawnSync(process.env.NAGA ?? 'naga',['--stdin-file-path','factory-compute.wgsl'],{input:shader,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
 }finally{s.close();}
}
assert.throws(()=>fixture({pressureRadius:.2}),/unsupported/i);
console.log('PBF radius/volume identity, selected initialization timestep and composed WGSL pass');
