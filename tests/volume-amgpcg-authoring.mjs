// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolvePressureSolverConfig} from '../volume-core.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name){const start=html.indexOf(`function ${name}(`);if(start<0)return '';return html.slice(start,html.indexOf('\n}\n',start)+2);}
const descriptors=(solver,algorithm,iterations)=>Object.fromEntries([['volume-pressure-solver',solver],['volume-pressure-algorithm',algorithm],['volume-pressure-cg-iterations',iterations]].map(([id,value])=>[id,{value}]));
function context(extra){const c=vm.createContext({resolvePressureSolverConfig,...extra});vm.runInContext(extract('flamePressureControlPatch'),c);return c;}
test('whole-basin admission includes the new pressure fields atomically when leaving AMGPCG',()=>{
 const current={pressureSolver:'converged-open-top',pressureAlgorithm:'amgpcg',pressureCgIterations:6};let admitted;
 const c=context({readAdaptiveMaterialControls(){},GRID_TUNING_FIELDS:[],volumePrototype:{validateGridControls(patch){resolvePressureSolverConfig({...current,...patch});admitted=patch;}},supersedeVolumeRebuildHolds(){throw Error('stopped-after-admission');}});
 vm.runInContext(extract('writeFlameSettingsState'),c);
 assert.throws(()=>c.writeFlameSettingsState({domControls:descriptors('legacy','sor',8)}),/stopped-after-admission/);
 assert.equal(admitted.pressureAlgorithm,'sor');assert.equal(admitted.pressureCgIterations,8);
});
test('whole-settings checks reject incompatible algorithms and invalid CG budgets before writing',()=>{
 for(const [solver,algorithm,iterations]of [['legacy','amgpcg',6],['converged','amgpcg',3.5],['converged','amgpcg','']]){
  const state={domControls:descriptors(solver,algorithm,iterations),rendererControls:{},presentationControls:{}};
  const c=context({flameSettingsState:()=>state,GRID_TUNING_FIELDS:[],document:{getElementById(id){return id==='volume-pressure-cg-iterations'?{tagName:'INPUT',type:'number'}:{tagName:'SELECT',options:(id==='volume-pressure-solver'?['legacy','converged','converged-open-top']:['sor','amgpcg']).map(value=>({value}))};}}});
  vm.runInContext(extract('flameSettingsStateProblems'),c);
  assert.ok(c.flameSettingsStateProblems(state).length,`${solver}/${algorithm}/${iterations} must be refused before mutation`);
 }
});
