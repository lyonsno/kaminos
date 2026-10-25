// kaminos-test: node
import assert from 'node:assert/strict';
import {viscosityScale} from '../finger-fluid-viscosity-scale.mjs';
for (const dt of [1/60,1/30,1/15]) {
 const h=.12742276, expected=(dt/(1/60))*(.185/h)**2;
 assert.equal(viscosityScale('nominal_diffusion',dt,h),expected,'Exploration must preserve the requested viscosity scale, even beyond convex mixing');
}
for(const dt of [0,-1,NaN,Infinity]) assert.throws(()=>viscosityScale('nominal_diffusion',dt,.1));
console.log('Exploratory timestep retains its viscosity coefficient');
const {validateMaterialControls}=await import('../finger-fluid-material-controls.mjs');
const {resolveFingerFluidCapillaryStrength,resolveFingerFluidFreeFlightViscosityBoost}=await import('../finger-fluid-webgpu-core.js');
const values={particleRepulsionStrength:3,densityIterations:2,capillaryStrength:3,freeFlightViscosityBoost:.6};
assert.deepEqual(validateMaterialControls(values),values,'Material inputs must retain values beyond prior UI tuning ranges');
assert.equal(resolveFingerFluidCapillaryStrength(3),3);assert.equal(resolveFingerFluidFreeFlightViscosityBoost(.6),.6);
for(const key of ['capillaryStrength','freeFlightViscosityBoost'])for(const value of [-1,Infinity,NaN,1e100])assert.throws(()=>validateMaterialControls({...values,[key]:value}));
