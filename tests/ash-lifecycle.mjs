// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {disposeAsh} from '../ash/lifecycle.mjs';
test('scene cleanup rejection still releases every owned resource and preserves failure',async()=>{
 const seen=[],failure=Error('scene removal failed');
 await assert.rejects(()=>disposeAsh({controls:[{dispose(){seen.push('control');}}],patch:{dispose(){seen.push('gpu');}},session:{async dispose(){seen.push('scene');throw failure;}},device:{removeEventListener(){seen.push('listener');}},onError(){}}),e=>e instanceof AggregateError&&e.errors.includes(failure));
 assert.deepEqual(seen,['control','gpu','scene','listener']);
});
test('one failed cleanup does not skip the remaining controls or patch',async()=>{
 const seen=[];await assert.rejects(()=>disposeAsh({controls:[{dispose(){throw Error('control');}},{dispose(){seen.push('control2');}}],patch:{dispose(){seen.push('gpu');}},session:{async dispose(){seen.push('scene');}},device:{removeEventListener(){seen.push('listener');}},onError(){}}),AggregateError);
 assert.deepEqual(seen,['control2','gpu','scene','listener']);
});
