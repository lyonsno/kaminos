// kaminos-test: node
import assert from 'node:assert/strict';
import {checkDisintegrationEvidence} from '../tools/disintegration-contracts.mjs';
const frame=(name,attached,detached,gas,attachedFuel,residue,solidCells)=>({name,attached,detached,gas,attachedFuel,residue,solidCells,state:{burner:false,fluid:{active:true,error:null}}});
const good={kernel:{status:'passed',records:[{},{},{},{},{}]},effective:{backend:'WebGPU:apple',grid:32,rays:28,radius:.1,gi:{steps:4,slices:3}},errors:[],httpFailures:[],frames:[frame('cold',10,0,0,10,0,30),frame('consumed',8,2,3,6.7,.3,24),frame('reset',10,0,0,10,0,30)]};
assert.equal(checkDisintegrationEvidence(good),true);
const stopped=structuredClone(good);stopped.frames[1].state.fluid={active:false,error:'static-light-transparent-caster:mesh_0'};
assert.throws(()=>checkDisintegrationEvidence(stopped),/runtime|active|transparent-caster/,'A recorded fatal volume error must fail even without console or page exceptions');
for(const change of [r=>r.kernel=null,r=>r.effective.backend='cpu',r=>r.effective.grid=48,r=>r.effective.rays=64,r=>r.effective.gi.steps=6,r=>r.frames.pop(),r=>r.frames.push(r.frames[0]),r=>r.frames[1].detached=0,r=>r.frames[1].solidCells=30,r=>r.frames[1].gas=NaN,r=>r.frames[1].residue=10,r=>r.frames[1].state.burner=true,r=>r.frames[2].detached=1,r=>r.errors.push('pipeline invalid'),r=>r.httpFailures.push({status:500})]){
 const r=structuredClone(good);change(r);assert.throws(()=>checkDisintegrationEvidence(r));
}
