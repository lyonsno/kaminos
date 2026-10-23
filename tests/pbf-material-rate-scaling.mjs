// kaminos-test: node
import assert from 'node:assert/strict';
import {authoredDropSetup} from '../authored-water-host.mjs';
import {lazarusFiniteSetup} from '../experiments/lazarus-fluid/contributions.mjs';
import * as material from '../finger-fluid-material-controls.mjs';
const source={id:'water',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.5,samplesPerUnit:24,container:null}}};
assert.equal(authoredDropSetup([source]).solver.materialScaling,'reference_acceleration','Authored water must opt into timestep/support/pass-aware material scaling');
assert.equal(lazarusFiniteSetup().solver.materialScaling,'reference_acceleration','Drop and dam-break comparison must use the same material law');
const {resolvePBFMaterialScale,PBF_REPULSION_COEFFICIENT}=material;
const reference={dt:1/60,supportRadius:.185,densityIterations:3,particleRepulsionStrength:.62};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
const ref=resolvePBFMaterialScale('reference_acceleration',reference);
near(ref.repulsionCoefficient,PBF_REPULSION_COEFFICIENT*.62);near(ref.dragRetention,.991);
const invariant=({dt,supportRadius,densityIterations},r)=>r.repulsionCoefficient*densityIterations/(supportRadius*dt*dt);
for(const dt of [1/240,1/120,1/60])for(const supportRadius of [.06371138,.12742276,.185])for(const densityIterations of [1,2,3,6]){
 const input={...reference,dt,supportRadius,densityIterations};const r=resolvePBFMaterialScale('reference_acceleration',input);
 near(invariant(input,r),invariant(reference,ref));near(r.dragRetention**(1/dt),ref.dragRetention**(1/reference.dt));
 const old=resolvePBFMaterialScale('legacy',input);near(old.repulsionCoefficient,ref.repulsionCoefficient);near(old.dragRetention,.991);
}
near(resolvePBFMaterialScale('reference_acceleration',{...reference,particleRepulsionStrength:0}).repulsionCoefficient,0);
for(const patch of [{dt:0},{dt:NaN},{supportRadius:0},{densityIterations:0},{densityIterations:1.5},{particleRepulsionStrength:-1}])assert.throws(()=>resolvePBFMaterialScale('reference_acceleration',{...reference,...patch}),/positive|finite|nonnegative|integer/i);
assert.throws(()=>resolvePBFMaterialScale('mystery',reference),/Unknown/);
console.log('Finite PBF reference acceleration and drag-rate invariants across timestep, support and pass count');
