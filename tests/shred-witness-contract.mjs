// kaminos-test: node
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateShredWitness,parseShredArms} from '../tools/shred-witness-contract.mjs';
const good={state:{backend:'WebGPU:apple',effectiveRoute:'native-3d-compute-fluid-raymarch-v0',
  appearanceModel:{requested:'shred-only',effective:'shred-only'},
  simulationPipelines:{'cs:combined':{constants:{SHRED_ONLY:true,NO_ACTIVITY:false}}}},
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

const inactive={...good,state:{...good.state,appearanceModel:{requested:'no-activity',effective:'no-activity'},
  simulationPipelines:{'cs:combined':{constants:{SHRED_ONLY:true,NO_ACTIVITY:true}}}},field:good.field.map((v,i)=>i===13?0:v)};
assert.doesNotThrow(()=>validateShredWitness(inactive,{mode:'no-activity',steps:3}));
for(const bad of [
  {...inactive,field:good.field},
  {...inactive,state:{...inactive.state,simulationPipelines:{'cs:combined':{constants:{SHRED_ONLY:true,NO_ACTIVITY:false}}}}},
  {...inactive,front:[1]},
]) assert.throws(()=>validateShredWitness(bad,{mode:'no-activity',steps:3}));

assert.throws(()=>parseShredArms('[]'),/nonempty/);
const out=mkdtempSync(join(tmpdir(),'shred-empty-arms-'));
const run=spawnSync(process.execPath,['scripts/check-shred-only.mjs',process.cwd(),'unused-scene','unused-offer',out],{env:{...process.env,SHRED_ARMS:'[]'},encoding:'utf8'});
assert.equal(run.status,1,run.stderr);
const failure=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
assert.equal(failure.ok,false);
assert.match(failure.error,/nonempty array/);
assert.equal(failure.phase,'source');
assert.equal(failure.origin,undefined);
for(const split of [false,true])for(const role of split?['material','velocity']:['combined']){
 const pipelines=Object.fromEntries((split?['material','velocity']:['combined']).map(r=>['cs:'+r,{constants:{SHRED_ONLY:true,NO_ACTIVITY:r===role}}]));
 const wrong={...good,state:{...good.state,simulationPipelines:pipelines}};
 assert.throws(()=>validateShredWitness(wrong,{mode:'shred-only',steps:3,split}),/activity pipeline/);
}
