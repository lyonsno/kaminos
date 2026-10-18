// kaminos-test: node
import assert from 'node:assert/strict';
import {validateRigCastState} from '../tools/rig-cast-witness.mjs';
const casts=['clay','clean'].map((slug,i)=>({slug,case_sha256:String(i+1).repeat(64),motion_sha256:'a'.repeat(64),frame_sha256:'b'.repeat(64)})),setup={casts};
const state={actors:casts.map((c,i)=>({slug:c.slug,objectId:'actor'+i,source:{caseSha256:c.case_sha256,motionSha256:c.motion_sha256,frameSha256:c.frame_sha256,effectiveMotionRoute:'retained-source-plus-fixed-rest-descendants'},skin:{vertices:100,bones:36,deformation:{backend:'webgpu-dense-dq',dispatches:1}},playback:{status:'paused',frame:10,actualLocalPose:{bones:Array.from({length:36},(_,i)=>({name:'b'+i,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}))}}}))};
validateRigCastState(state,setup,10);
for(const mutate of [s=>s.actors.pop(),s=>s.actors[1].objectId=s.actors[0].objectId,s=>s.actors[0].source.caseSha256='0'.repeat(64),s=>s.actors[0].source.frameSha256='0'.repeat(64),s=>s.actors[0].source.motionSha256='0'.repeat(64),s=>s.actors[0].skin.deformation.backend='cpu-reference',s=>s.actors[0].playback.frame=0,s=>s.actors[0].playback.status='playing',s=>s.actors[0].playback.actualLocalPose.bones=[],s=>s.actors[0].skin.vertices=0]){
 const invalid=structuredClone(state);mutate(invalid);assert.throws(()=>validateRigCastState(invalid,setup,10));
}
console.log('rig-cast witness rejects wrong/partial/stale/fallback/unheld results');
