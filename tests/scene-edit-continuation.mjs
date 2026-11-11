// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneEdits} from '../scene-edit-session.mjs';
let value={value:0},continuation,commits=0;
const edits=createSceneEdits({read(){throw Error('unused');},write(){throw Error('unused');}});
edits.register('@moving',{read:()=>value,check:v=>v,write:v=>value=v,committed:c=>{continuation=c;commits++;}});
edits.register('@other',{read:()=>({value:0}),check:v=>v,write(){}});
edits.begin('@moving');edits.preview({value:1});edits.commit();
assert.equal(commits,1,'A committed target must be able to finish a dynamic edit in its existing history entry');
assert.equal(continuation.current(),true);value={value:4};assert.equal(continuation.amend(),true);assert.equal(edits.state().undoCount,1);
edits.undo();assert.deepEqual(value,{value:0});assert.equal(continuation.current(),false);assert.equal(continuation.amend(),false,'An old simulation cannot amend history after Undo');
edits.redo();assert.deepEqual(value,{value:4},'Redo restores the final achieved pose, without restarting motion');
edits.begin('@moving');edits.preview({value:5});edits.commit();const second=continuation;
edits.begin('@other');assert.equal(second.current(),false);assert.equal(second.amend(),false,'Starting another edit retires the preceding continuation');edits.cancel();assert.equal(second.current(),false,'Cancelling the new gesture must not revive old motion');
edits.begin('@moving');edits.preview({value:6});edits.cancel();assert.equal(commits,2,'Cancel never launches after-release motion');
edits.begin('@moving');edits.commit();assert.equal(commits,2,'An unchanged gesture never launches a continuation');
edits.begin('@moving');edits.preview({value:7});edits.commit();const third=continuation;third.finish();assert.equal(third.current(),false);assert.equal(third.amend(),false);
assert.equal(edits.state().undoCount,3);
console.log('Post-commit dynamic continuation keeps one history entry, exact Undo/Redo and irreversible interruption');
