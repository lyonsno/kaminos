// kaminos-test: node
import assert from 'node:assert/strict';
import {createAttentionPolicy} from '../experiments/creature-motion/attention-policy.mjs';

const observation={id:'brazier',point:[1,2,3],score:2,reason:'authored-interest'};
const policy=createAttentionPolicy();policy.update({time:1,observations:[observation]});
const before=policy.snapshot();
for(const change of [
 s=>{s.current.point=null;},
 s=>{s.current.score=NaN;},
 s=>{s.current.acquiredAt=5;},
 s=>{s.current.lastObservedAt=2;},
 s=>{s.current.memorySeconds=-1;},
 s=>{delete s.config.minDwellSeconds;},
 s=>{s.lastTime=null;},
]){
 const snapshot=structuredClone(before);snapshot.config.minDwellSeconds=42;change(snapshot);
 assert.throws(()=>policy.restore(snapshot),'Malformed continuation must be rejected');
 assert.deepEqual(policy.snapshot(),before,'Rejected restore must not partially change configuration or focus');
}
const released=policy.update({time:1.1,observations:[observation],invalidatedIds:['brazier']});
assert.equal(released.focus,null,'A source invalidated in this update cannot immediately reacquire through the same observation');
policy.update({time:2,observations:[observation]});
assert.equal(policy.read().focus.id,'brazier','Invalidation does not create a hidden permanent tombstone');
console.log('Attention continuation validates transactionally and same-update invalidation cannot silently reacquire the source');
