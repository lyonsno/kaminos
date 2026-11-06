// kaminos-test: node
import assert from 'node:assert/strict';
import * as contract from '../tools/shred-witness-contract.mjs';
const {validateShredWitness}=contract;
assert.equal(contract.isShredWitnessFatalConsole?.('THREE.TSL: Invalid generated code, expected a "vec3".'),true,'console-only compiler failure must terminate the witness');
assert.equal(contract.isShredWitnessFatalConsole?.('THREE.TSL: Deprecated API warning'),false);
const good={state:{backend:'WebGPU:apple',effectiveRoute:'native-3d-compute-fluid-raymarch-v0',
  appearanceModel:{requested:'shred-only',effective:'shred-only'},
  simulationPipelines:{'cs:combined':{constants:{SHRED_ONLY:true}}}},
  replay:{ok:true,requestedSteps:3,completedSteps:3},field:[0,0,0,0,1,1,1,0,0,0,0,0,0,.5,0,0]};
assert.doesNotThrow(()=>validateShredWitness(good, {mode:'shred-only',steps:3}));
for(const bad of [
  {...good,replay:{...good.replay,completedSteps:2}},
  {...good,state:{...good.state,backend:'WebGPU:swiftshader'}},
  {...good,state:{...good.state,appearanceModel:{requested:'shred-only',effective:'authored'}}},
  {...good,state:{...good.state,simulationPipelines:{}}},
  {...good,field:[]}, {...good,field:[...good.field.slice(0,15),NaN]},
  {...good,field:good.field.map((v,i)=>i===8?1:v)},
]) assert.throws(()=>validateShredWitness(bad,{mode:'shred-only',steps:3}));
