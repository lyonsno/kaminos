import assert from 'node:assert/strict';
import {prepareSeparatedTopology,packSolidTopology} from '../structural-material-solid-topology.mjs';
import {INTERIOR_CUT_ROUTE} from '../structural-material-interior-cut.mjs';
const resident=await import('../structural-material-solid-resident.js');
assert.equal(typeof resident.selectSolidEnergyKernel,'function','Explicit coefficient-checked energy specialization is required');
const model=prepareSeparatedTopology({status:'passed',route:INTERIOR_CUT_ROUTE,positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],volume:1/6},{young:100000,poisson:.25});
const descriptor={...model,points:4,elements:1,bonds:6},arrays=packSolidTopology(model);
assert.equal(resident.selectSolidEnergyKernel(descriptor,arrays),'isotropic-intact-v1');
assert.equal(resident.selectSolidEnergyKernel(descriptor,arrays,'dense-reference'),'dense-reference');
for(const mutate of [a=>a.coefficients[3]=1,a=>a.coefficients[7]+=1,a=>a.coefficients[21]+=1,a=>a.coefficients[0]=NaN]){
 const changed={...arrays,coefficients:arrays.coefficients.slice()};mutate(changed);
 assert.equal(resident.selectSolidEnergyKernel(descriptor,changed),'dense-reference','A material name must not authorize altered coefficients');
}
assert.equal(resident.selectSolidEnergyKernel({...descriptor,constitutiveLayout:undefined},arrays),'dense-reference');
assert.throws(()=>resident.selectSolidEnergyKernel(descriptor,arrays,'approximate'),/energy kernel/);
console.log('Exact isotropic specialization admission passed');
