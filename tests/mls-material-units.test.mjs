// kaminos-test: node
import assert from 'node:assert/strict';
import {mlsConfig} from '../mls-juice-contract.mjs';
import {authoredMlsSetup,authoredMlsMaterial} from '../authored-mls-water.mjs';
import {defaultLocalLiquidSetup,normalizeLocalLiquidSetup} from '../local-liquid-setup.mjs';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=1e-12*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);
const material={pressureWaveSpeed:2,kinematicViscosity:.0005};
// Recover the world coefficients from the actual kernel constants, independently
// of any new readout. Merely reporting the requested values cannot pass.
for(const cell of [.1,.05,.025]){
 const c=mlsConfig({cellSize:cell,mlsMaterial:material});
 near(c.stiffness/c.restDensity*(cell*c.modelSecondsPerSecond)**2,4);
 near(c.viscosity/c.restDensity*cell**2*c.modelSecondsPerSecond,.0005);
 near(.4*cell*c.modelSecondsPerSecond**2,9.81);
}
for(const cell of [.1,.05,.025]){
 const c=mlsConfig({cellSize:cell});assert.equal(c.stiffness,50);assert.equal(c.viscosity,.1);
 assert.equal(mlsConfig({cellSize:cell,viscosity:.6}).viscosity,.6);
}
const normalized=normalizeLocalLiquidSetup({...defaultLocalLiquidSetup(),mlsMaterial:material});
assert.deepEqual(normalized.mlsMaterial,material,'saving shared water settings must retain explicit world material');
assert.deepEqual(normalizeLocalLiquidSetup(JSON.parse(JSON.stringify(normalized))),normalized);
assert.equal(normalizeLocalLiquidSetup({...normalized,mlsMaterial:null}).mlsMaterial,undefined);
const source={id:'drop',type:'local-liquid-emitter',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width:.2,samplesPerUnit:20}}};
for(const samplesPerUnit of [20,40]){
 const row=structuredClone(source);row.localLiquidEmitter.drop.samplesPerUnit=samplesPerUnit;
 const initial=authoredMlsSetup([row],normalized),c=mlsConfig(initial.solver);
 near(c.stiffness/c.restDensity*(c.cell*c.modelSecondsPerSecond)**2,4);
 near(authoredMlsMaterial([row],normalized).pressureWaveSpeed,2);
 near(c.viscosity/c.restDensity*c.cell**2*c.modelSecondsPerSecond,.0005);
}
const zero=mlsConfig({mlsMaterial:{pressureWaveSpeed:0,kinematicViscosity:0}});assert.equal(zero.stiffness,0);assert.equal(zero.viscosity,0);
for(const value of [NaN,Infinity,-1,'2'])for(const key of Object.keys(material)){
 const m={...material,[key]:value};assert.throws(()=>mlsConfig({mlsMaterial:m}),/material/i);assert.throws(()=>normalizeLocalLiquidSetup({...normalized,mlsMaterial:m}),/material/i);
}
assert.throws(()=>mlsConfig({mlsMaterial:{pressureWaveSpeed:2}}),/material/i);
assert.throws(()=>mlsConfig({mlsMaterial:material,viscosity:.6}),/ambiguous/i);
console.log('Explicit MLS world material survives resolution and persistence; legacy coefficients unchanged');
