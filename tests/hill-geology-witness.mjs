// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as witness from '../experiments/hill-terrain/witness.mjs';
assert.equal(typeof witness.validateFormedRead,'function','Formed-landscape evidence must verify the effective cache recipe and mounted GPU source');
const {validateFormedRead}=witness;
const config={seed:47,resolution:129,iterations:260};
const good=()=>({route:'kaminos/hill/geological-formation-v1',config,formation:{config,version:'hill-geology-3',steps:260},pending:null,error:null,runtimeReadback:false,gpu:{backend:'webgpu',initialized:true,error:null,provenance:{kind:'formed-landscape',recipe:config,version:'hill-geology-3'},steps:0}});
test('formation witness refuses fallback, pending, failed, stale and requested-only evidence',()=>{
 assert.doesNotThrow(()=>validateFormedRead(good(),config));
 for(const change of [s=>s.gpu.backend='webgl',s=>s.gpu.initialized=false,s=>s.pending={step:1},s=>s.error='failed',s=>s.formation=null,s=>s.formation.config={...config,seed:0},s=>s.gpu.provenance.recipe={...config,seed:0},s=>s.runtimeReadback=true,s=>s.formation.steps=3]){const s=good();change(s);assert.throws(()=>validateFormedRead(s,config));}
});
