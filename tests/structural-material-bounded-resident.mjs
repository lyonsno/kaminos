import assert from 'node:assert/strict';
import {prepareSolidTopology,packSolidTopology} from '../structural-material-solid-topology.mjs';
import {selectSolidEnergyKernel,solidResidentWgsl} from '../structural-material-solid-resident.js';
const mesh={status:'passed',route:'ftetwild-cpu-wildmeshing-0.4.1',positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],volume:1/6};
const model=prepareSolidTopology(mesh,{kind:'graph',damageLaw:'event-frozen-isotropic-degradation-v1'}),arrays=packSolidTopology(model),descriptor={kind:'graph',elements:1,constitutiveLayout:model.constitutiveLayout};
assert.equal(selectSolidEnergyKernel(descriptor,arrays),'isotropic-degradation-v1','Compact resident kernel identity required');
const nonisotropic={...arrays,coefficients:arrays.coefficients.slice()};nonisotropic.coefficients[0]+=10;assert.throws(()=>selectSolidEnergyKernel(descriptor,nonisotropic),/isotropic/i);
assert.ok(solidResidentWgsl.includes('fn fractureStress('));assert.ok(solidResidentWgsl.includes('fn degrade('));
console.log('Compact resident dispatch identity and separate stress-release/degradation entry points exist; native conformance remains required');
