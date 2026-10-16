// kaminos-test: node
import assert from 'node:assert/strict';
let module={};try{module=await import('../tools/living-scene-witness.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof module.validateActors,'function','Multi-actor witness must reject missing/duplicate/wrong-source/fallback bodies');
const setup={actors:['a','b'].map((id,i)=>({id,creature:{case_sha256:String(i).repeat(64),motion_sha256:'c'.repeat(64),frame_sha256:'d'.repeat(64),deformation:'gpu'}}))};
const valid={actors:setup.actors.map(a=>({id:a.id,state:{host:{id:a.id},source:{caseSha256:a.creature.case_sha256,motionSha256:a.creature.motion_sha256,frameSha256:a.creature.frame_sha256},deformation:{requested:'gpu',effective:'webgpu-dense-dq'},actorRoot:{effective:'live-pelvis'},playback:{status:'paused'}}}))};
module.validateActors(valid,setup);
for(const corrupt of [r=>r.actors.pop(),r=>r.actors[1].state.host.id='a',r=>r.actors[1].state.source.caseSha256='e'.repeat(64),r=>r.actors[0].state.deformation.effective='cpu-reference',r=>r.actors[0].state.actorRoot.effective='authored-spawn',r=>r.actors[0].state.playback.status='removed']){const r=structuredClone(valid);corrupt(r);assert.throws(()=>module.validateActors(r,setup));}
console.log('Actor evidence rejects missing/duplicate bodies, wrong source, backend fallback, stale roots and removed registrations');
