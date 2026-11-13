// kaminos-test: node
import assert from 'node:assert/strict';
const mod = await import('../hand-input-state.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
assert.equal(typeof mod.createHandInput, 'function', 'Kaminos needs shared hand input independent of the selected experiment');
const {createHandInput} = mod;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(overrides={}) {
  const calls={cameraStops:0,loads:[],destroyed:[],shown:[],clears:0,schedules:[]};
  const camera={stop(){calls.cameraStops++;},schedule(fn){calls.schedules.push(fn);},async frame(){return {source:{},width:640,height:480,close(){}};}};
  const input=createHandInput({openCamera:async()=>camera,
    loadModel:async model=>{calls.loads.push(model);return {model,identity:{model,backend:'fixture'},
      async infer({sides,getFrame}){await getFrame();return {hands:sides.map(handedness=>({handedness,hasHand:true})),identity:this.identity};},
      stop(){},async destroy(){calls.destroyed.push(model);}};},
    present:result=>calls.shown.push(result),clear:()=>calls.clears++, ...overrides});
  return {input,calls,camera};
}
{
  const {input,calls}=fixture();
  assert.equal(input.read().enabled,false);
  assert.equal(calls.loads.length,0,'disabled hand input must not load or request the camera');
  await input.setEnabled(true);
  await calls.schedules.shift()();
  assert.deepEqual(calls.shown[0].hands.map(h=>h.handedness),['left','right']);
  await input.setAuto('right',false);
  await calls.schedules.pop()();
  assert.deepEqual(calls.shown.at(-1).hands.map(h=>h.handedness),['left']);
  await input.setModel('dsconv');
  assert.deepEqual(calls.loads,['spiralconv','dsconv']);
  assert.deepEqual(calls.destroyed,['spiralconv']);
  assert.equal(input.read().effectiveModel,'dsconv');
  await input.setEnabled(false);
  assert.equal(calls.cameraStops,1);
  assert.deepEqual(calls.destroyed,['spiralconv','dsconv']);
  assert.equal(input.read().phase,'off');
  await assert.rejects(input.setModel('vjepa'),/model/);
  await input.dispose();
}
{
  const gate=deferred(); const {input,calls,camera}=fixture({openCamera:()=>gate.promise});
  const starting=input.setEnabled(true);await tick();
  const stopping=input.setEnabled(false);
  gate.resolve(camera);await Promise.all([starting,stopping]);
  assert.equal(calls.cameraStops,1,'Stop owns a camera which arrives after cancellation');
  assert.equal(calls.loads.length,0);assert.equal(input.read().phase,'off');
  await input.dispose();
}
{
  const entered=deferred(),gate=deferred();
  const {input,calls}=fixture({loadModel:async model=>({model,identity:{model,backend:'fixture'},
    async infer({getFrame}){await getFrame();entered.resolve();await gate.promise;return {hands:[{handedness:'left',hasHand:true}]};},
    stop(){gate.resolve();},async destroy(){calls.destroyed.push(model);}})});
  await input.setEnabled(true);
  const old=calls.schedules.shift()();await entered.promise;
  await input.setEnabled(false);await old;
  assert.equal(calls.shown.length,0,'a late completed inference must not resurrect stopped hands');
  await input.dispose();
}
{
  const {input}=fixture({loadModel:async()=>{throw Error('weights unavailable');}});
  await assert.rejects(input.setEnabled(true),/weights unavailable/);
  assert.equal(input.read().phase,'error');
  assert.equal(input.read().effectiveModel,null,'failed model loading must not claim the requested model is effective');
  await input.dispose();
}
console.log('shared hand input lifecycle passed');
{
  let closed=0;
  const {input,calls}=fixture({record:{close:async()=>closed++},loadModel:async()=>{throw Error('load failed');}});
  await assert.rejects(input.setEnabled(true),/load failed/);
  assert.equal(closed,1,'failed activation must close its capture worker');
  assert.equal(input.read().enabled,false,'fatal activation must release the enabled state');
  await input.setAuto('left',false);
  assert.equal(calls.schedules.length,0,'changing an auto setting after failure must not restart capture');
  await input.dispose();
}
{
  const {input,calls}=fixture();await input.setEnabled(true);
  await input.setAuto('left',false);calls.schedules.length=0;
  await input.setAuto('right',false);
  assert.equal(calls.schedules.length,0,'no armed side means no empty per-video-frame loop');
  await input.setAuto('left',true);assert.equal(calls.schedules.length,1);
  await input.dispose();
}
