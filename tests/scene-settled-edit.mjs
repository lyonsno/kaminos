// kaminos-test: node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSceneEdits } from '../scene-edit-session.mjs';

function fixture() {
  let value={present:false},rejectNext=false,resolveMount;
  const edits=createSceneEdits({read:()=>null,write:()=>{}});
  edits.register('@field',{read:()=>value,check:v=>v,write:next=>{
    const previous=value;value=next;
    if(!next.present)return;
    const mount=rejectNext?Promise.reject(Error('activation refused')):new Promise(resolve=>{resolveMount=resolve;});
    rejectNext=false;
    return mount.catch(error=>{value=previous;throw error;});
  }});
  const apply=v=>(edits.applySettled||edits.apply).call(edits,'@field',v,'Add field');
  return {edits,apply,read:()=>value,reject:()=>{rejectNext=true;},resolve:()=>resolveMount()};
}
test('rejected settled Add preserves prior authored state and history, then retries', async()=>{
  const f=fixture();f.reject();
  await assert.rejects(()=>Promise.resolve(f.apply({present:true})),/activation refused/);
  assert.deepEqual(f.read(),{present:false});assert.equal(f.edits.state().undoCount,0);assert.equal(f.edits.state().active,null);
  const retry=f.apply({present:true});f.resolve();await retry;assert.equal(f.edits.state().undoCount,1);
});
test('Undo cancels pending Add and prevents its later settlement from committing',async()=>{
  const f=fixture(),pending=Promise.resolve(f.apply({present:true}));
  const rejected=assert.rejects(pending,/cancelled/);
  await f.edits.undo();assert.deepEqual(f.read(),{present:false});f.resolve();await rejected;
  assert.equal(f.edits.state().undoCount,0);assert.equal(f.edits.state().active,null);
});
test('Redo rejection retains the redo entry and prior state for a later retry',async()=>{
  const f=fixture(),first=f.apply({present:true});f.resolve();await first;await f.edits.undo();f.reject();
  await assert.rejects(()=>Promise.resolve(f.edits.redo()),/activation refused/);
  assert.deepEqual(f.read(),{present:false});assert.equal(f.edits.state().redoCount,1);assert.equal(f.edits.state().undoCount,0);
  const retry=f.edits.redo();f.resolve();await retry;assert.equal(f.edits.state().undoCount,1);
});
