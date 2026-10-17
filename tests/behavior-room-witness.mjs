// kaminos-test: node
import assert from 'node:assert/strict';
let api={};try{api=await import('../tools/behavior-room-witness.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof api.validateBehaviorRoom,'function','Behavior evidence must bind actual zones, local flags, body and scene state');
const t={position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1]},places=[{zoneId:'yard',enabled:true,preference:2}],creature={case_sha256:'a',motion_sha256:'b',frame_sha256:'c',deformation:'gpu',transform:t,action:'wander'};
const setup={running:false,zones:[{id:'yard',label:'Yard',transform:t}],actors:[{id:'one',active:true,places,creature}]};
const state={running:false,zones:[{id:'yard',label:'Yard',transform:t,mounted:true,hostId:'zone'}],actors:[{id:'one',active:true,places,state:{source:{caseSha256:'a',motionSha256:'b',frameSha256:'c'},deformation:{requested:'gpu',effective:'webgpu-dense-dq'},actorRoot:{effective:'live-pelvis',authoredTransform:t},host:{id:'body'},skin:{bones:32},action:{kind:'wander'},playback:{status:'paused'}}}]};
api.validateBehaviorRoom(state,setup);
for(const mutate of [s=>s.zones=[],s=>s.zones[0].mounted=false,s=>s.actors[0].places[0].enabled=false,s=>s.actors[0].active=false,s=>s.running=true,s=>s.actors[0].state.skin.bones=28,s=>s.actors[0].state.deformation.effective='cpu-reference',s=>s.actors[0].state.source.motionSha256='stale']){const wrong=structuredClone(state);mutate(wrong);assert.throws(()=>api.validateBehaviorRoom(wrong,setup));}
api.validateBehaviorRoom({...state,newField:123},setup);
assert.equal(typeof api.validateRendererConsole,'function','Renderer-rejected visible output can silently pass the witness');
assert.throws(()=>api.validateRendererConsole([{type:'error',text:'THREE.Renderer: Objects of type THREE.LineLoop are not supported.'}]),/Renderer/);
api.validateRendererConsole([{type:'warning',text:'Optional adapter information unavailable'}]);
console.log('Missing/stale/shared-world and source/backend false closure rejected; additive state remains compatible');
