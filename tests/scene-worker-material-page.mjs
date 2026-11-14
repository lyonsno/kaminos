// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../scene-worker-material-page.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND'||error.url!==new URL('../scene-worker-material-page.mjs',import.meta.url).href)throw error;return {};});
test('worker material gesture waits for its identity and orders previews before one commit',async()=>{
 assert.equal(typeof module.createWorkerMaterialGesture,'function','page tuning must use a worker-owned gesture identity');
 const calls=[];let start;
 const gesture=module.createWorkerMaterialGesture({recipeId:'recipe',call:(name,input)=>{calls.push({name,input});return name==='scene.materialBegin'?new Promise(resolve=>{start=resolve;}):Promise.resolve({});}});
 gesture.preview({parameters:{roughness:.4}});gesture.preview({parameters:{roughness:.6}});const done=gesture.commit();
 assert.deepEqual(calls.map(row=>row.name),['scene.materialBegin']);start({gestureId:'worker-gesture'});await done;
 assert.deepEqual(calls.map(row=>row.name),['scene.materialBegin','scene.materialPreview','scene.materialPreview','scene.materialCommit']);
 assert(calls.slice(1).every(row=>row.input.gestureId==='worker-gesture'));
});
test('a rejected preview cancels its actual gesture and preserves the error rather than committing or restarting',async()=>{
 assert.equal(typeof module.createWorkerMaterialGesture,'function');const calls=[];const failure=Error('invalid material');
 const gesture=module.createWorkerMaterialGesture({recipeId:'recipe',call:async(name,input)=>{calls.push({name,input});if(name==='scene.materialBegin')return {gestureId:'worker-gesture'};if(name==='scene.materialPreview')throw failure;return {};}});
 gesture.preview({parameters:{roughness:-1}});await assert.rejects(gesture.commit(),error=>error===failure);
 assert.deepEqual(calls.map(row=>row.name),['scene.materialBegin','scene.materialPreview','scene.materialCancel']);
});
test('a missing worker gesture identity cannot fall back to a local or stale identity',async()=>{
 const calls=[];const gesture=module.createWorkerMaterialGesture({recipeId:'recipe',call:async name=>{calls.push(name);return {};}});
 gesture.preview({parameters:{roughness:.3}}).catch(()=>{});
 await assert.rejects(gesture.commit(),/gesture identity/);assert.deepEqual(calls,['scene.materialBegin']);
});
test('a known applied Begin failure reconciles only its own worker identity before cancelling the gesture',async()=>{
 const failure=Object.assign(Error('draw failed after begin'),{mutationApplied:true,requestId:'begin-request'}),calls=[];
 const gesture=module.createWorkerMaterialGesture({recipeId:'recipe',readGesture:()=>({gestureId:'actual-gesture',recipeId:'recipe',requestId:'begin-request'}),
  call:async(name,input)=>{calls.push({name,input});if(name==='scene.materialBegin')throw failure;return {};}});
 await assert.rejects(gesture.commit(),error=>error===failure);
 assert.deepEqual(calls.map(row=>row.name),['scene.materialBegin','scene.materialCancel']);assert.equal(calls[1].input.gestureId,'actual-gesture');
});
test('an applied Begin failure never cancels a newer interaction with the same recipe',async()=>{
 const calls=[],failure=Object.assign(Error('old begin failed'),{mutationApplied:true,requestId:'old-request'});
 const gesture=module.createWorkerMaterialGesture({recipeId:'recipe',readGesture:()=>({gestureId:'new-gesture',recipeId:'recipe',requestId:'new-request'}),call:async name=>{calls.push(name);throw failure;}});
 await assert.rejects(gesture.cancel(),error=>error===failure);assert.deepEqual(calls,['scene.materialBegin']);
});
