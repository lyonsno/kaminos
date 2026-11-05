// kaminos-test: node
import assert from 'node:assert/strict';
import {validateBurnStructureSnapshot} from '../tools/burn-structure-contract.mjs';
const mapping={identity:'kaminos.burn-structure.sections.v1',connections:[{id:'section:0',a:0,b:1}],dimensions:[1,1,1],spans:[0,1],cells:[0],areas:[2]},material=[0,0,0,0,0,1,0,0];
const value={material,structure:{identity:mapping.identity,steps:1,mapping,sections:[{...mapping.connections[0],fraction:1,remainingArea:2,sampledArea:2,mapped:true}]}};
assert.equal(validateBurnStructureSnapshot(value).minFraction,1);
for(const mutate of [s=>s.structure.identity='projected',s=>s.structure.steps=0,s=>s.structure.sections=[],s=>s.structure.sections[0].fraction=0,s=>s.structure.sections[0].mapped=false,s=>s.material=[],s=>s.structure.mapping.cells=[9]]){
 const copy=structuredClone(value);mutate(copy);assert.throws(()=>validateBurnStructureSnapshot(copy));
}
