// kaminos-test: node
import assert from 'node:assert/strict';
let module={};try{module=await import('../tools/living-scene-witness.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof module.validateActors,'function','Multi-actor witness must reject missing/duplicate/wrong-source/fallback bodies');
const transform={position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1]},area={...transform,scale:[3,1,3]},motion={elapsed:0,heldFrame:null,path:{position:[0,0],rng:3663131627}};
const setup={actors:['a','b'].map((id,i)=>({id,creature:{case_sha256:String(i).repeat(64),motion_sha256:'c'.repeat(64),frame_sha256:'d'.repeat(64),deformation:'gpu',transform,wander:{area,motion},action:'wander'}}))};
const valid={actors:setup.actors.map(a=>({id:a.id,state:{host:{id:a.id},source:{caseSha256:a.creature.case_sha256,motionSha256:a.creature.motion_sha256,frameSha256:a.creature.frame_sha256},deformation:{requested:'gpu',effective:'webgpu-dense-dq'},actorRoot:{effective:'live-pelvis',authoredTransform:structuredClone(transform)},playback:{status:'paused'},action:{kind:'wander',area:{transform:structuredClone(area)}},recipe:{wander:{motion:structuredClone(motion)}}}}))};
module.validateActors(valid,setup);
for(const corrupt of [r=>r.actors.pop(),r=>r.actors[1].state.host.id='a',r=>r.actors[1].state.source.caseSha256='e'.repeat(64),r=>r.actors[0].state.deformation.effective='cpu-reference',r=>r.actors[0].state.actorRoot.effective='authored-spawn',r=>r.actors[0].state.playback.status='removed']){const r=structuredClone(valid);corrupt(r);assert.throws(()=>module.validateActors(r,setup));}
const stale=structuredClone(setup);stale.actors[0].creature.transform.position[0]+=100;stale.actors[0].creature.wander.area.position[0]+=100;
assert.throws(()=>module.validateActors(valid,stale),'Requested setup can silently differ from effective placement/area');
const otherRng=structuredClone(setup);otherRng.actors[0].creature.wander.motion.path.rng++;
assert.throws(()=>module.validateActors(valid,otherRng),'Different discrete continuation state was treated as rounding noise');
const world={objects:[{id:'terrain',source:'actual.glb',type:'glb',transform:{position:[1,2,3],rotation:[0,0,0],scale:[1,1,1]}}]},observed=structuredClone(world.objects);
module.validateWorld(observed,world);
for(const corrupt of [r=>r[0].source='stale.glb',r=>r[0].transform.position[0]+=100]){const r=structuredClone(observed);corrupt(r);assert.throws(()=>module.validateWorld(r,world));}
console.log('Actor evidence rejects missing/duplicate bodies, wrong source, backend fallback, stale roots and removed registrations');
