// kaminos-test: node
import assert from 'node:assert/strict';
import {initialFoldFlow,foldFlowPose,receiverEncounter,acceptFoldReceiver} from '../stockroom-fold-flow-state.mjs';
const initial=initialFoldFlow();
assert.equal(receiverEncounter(initial),null);
assert.throws(()=>acceptFoldReceiver(initial),/receiver/);
const folded={...initial,creased:true,angle:Math.PI*.8};
const encounter=receiverEncounter(folded);
assert.ok(encounter,'a folded leaf crossing its own receiver must expose an encounter');
assert.equal(encounter.moving,'leaf');assert.equal(encounter.receiving,'receiver');
assert.ok(encounter.point.every(Number.isFinite));
assert.equal(initial.receiver,false,'preview must not mutate the retained state');
const accepted=acceptFoldReceiver(folded);
assert.equal(accepted.receiver,true);assert.equal(folded.receiver,false);
assert.equal(receiverEncounter(accepted),null,'the opened receiver must actually clear the leaf');
assert.ok(foldFlowPose(folded).elements.every(Number.isFinite));
assert.equal(receiverEncounter({...folded,angle:Math.PI/2}),null,'a leaf above the receiver is not an encounter');
console.log('fold flow state: encounter identity, refusal, preview, actual clearing');
