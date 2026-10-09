import assert from 'node:assert/strict';
const api=await import('../structural-material-shard-release-evidence.mjs');
assert.equal(typeof api.inspectCutRefusalRegrip,'function','Refusal smoke needs a falsifiable retained-material regrip predicate');
const state={state:Array(16).fill(0)},declined={phase:'interactive',failure:null,runId:'retained',totalSteps:4,camera:{position:[1,2,3]},interior:{epoch:2,lastFailedCut:{disposition:'retained-material-continue',candidateState:{runId:'candidate',stresses:[{active:true,invalid:true}]}}},state};
const gripped={...structuredClone(declined),totalSteps:5,gesture:{phase:'active',inputClosed:false},state:{state:[...state.state]}};gripped.state.state[4]=.01;
assert.deepEqual(api.inspectCutRefusalRegrip(declined,gripped),[]);
for(const mutate of [w=>w.phase='failed',w=>w.failure={message:'error'},w=>w.runId='reset',w=>w.interior.epoch=0,w=>w.totalSteps=4,w=>w.gesture=null,w=>w.gesture.inputClosed=true,w=>w.camera.position[0]=8,w=>w.state.state[4]=0]){const bad=structuredClone(gripped);mutate(bad);assert.ok(api.inspectCutRefusalRegrip(declined,bad).length);}
for(const mutate of [w=>w.interior.lastFailedCut.candidateState.stresses[0].invalid=false,w=>w.interior.lastFailedCut=null,w=>w.interior.lastFailedCut.candidateState.runId='retained']){const bad=structuredClone(declined);mutate(bad);assert.ok(api.inspectCutRefusalRegrip(bad,gripped).length);}
assert.ok(api.inspectCutRefusalRegrip(null,gripped).length);
console.log('Synthetic evidence contract rejects Reset, camera fallback, latched failure, missing invalid candidate and stationary regrip; native identity is checked by the enclosing smoke.');
