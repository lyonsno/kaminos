// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as witness from '../tools/mls-witness-source.mjs';
assert.equal(typeof witness.validateMlsGoinRequest,'function','missing effective pile validator');
// Canonical effective envelope is exercised by the retained browser witness;
// this fixture tests only substitution rejection policy.
const requested={count:1,mass:.25,radius:.22,thickness:.1,particleMass:.001,couplingSteps:8,collisionSides:12};
const effective={route:'mls-particle-contact/cannon-es-0.20.0',bodyMass:.25,particleMass:.001,couplingSteps:8,collisionSides:12,
  bodies:[{mass:.25,radius:.22,thickness:.1}]};
witness.validateMlsGoinRequest(effective,requested);
for(const key of ['bodyMass','particleMass','couplingSteps','collisionSides']){
  const bad=structuredClone(effective);bad[key]*=2;
  assert.throws(()=>witness.validateMlsGoinRequest(bad,requested),/pile/);
}
for(const key of ['mass','radius','thickness']){
  const bad=structuredClone(effective);bad.bodies[0][key]*=2;
  assert.throws(()=>witness.validateMlsGoinRequest(bad,requested),/pile/);
}
assert.throws(()=>witness.validateMlsGoinRequest({...effective,bodies:[]},requested),/pile/);
assert.throws(()=>witness.validateMlsGoinRequest({...effective,route:'proxy'},requested),/pile/);
if(process.env.MLS_GOIN_REPORT){
  const report=JSON.parse(fs.readFileSync(process.env.MLS_GOIN_REPORT));
  witness.validateMlsGoinRequest(report.state.runtime.solver.bodies,report.requested.goinPile);
  for(const [key,value]of Object.entries({mass:2,particleMass:.02,couplingSteps:16,collisionSides:24,radius:.5,thickness:.2})){
    assert.throws(()=>witness.validateMlsGoinRequest(report.state.runtime.solver.bodies,{...report.requested.goinPile,[key]:value}),/pile/);
  }
}
console.log('Effective pile settings reject substituted mass, geometry and coupling');
