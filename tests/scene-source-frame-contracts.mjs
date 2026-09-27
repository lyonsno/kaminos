import assert from 'node:assert/strict';
import * as source from '../scene-volume-source.mjs';

assert.equal(typeof source.prepareSceneSourceFrame, 'function', 'shared source requires a submit-before-host frame boundary');
const events = [];
const prepared = {generation: 7, frame: 42};
const encoder = {finish() {events.push('finish-source'); return 'commands';}};
const next = {};
const result = source.prepareSceneSourceFrame({encoder,
  encode(e) {assert.equal(e,encoder); events.push('encode-source'); return prepared;},
  submit(commands) {assert.deepEqual(commands,['commands']); events.push('submit-source');},
  consume(field) {assert.equal(field,prepared); events.push('bind-host-input');},
  renderHost() {events.push('render-host'); return {label:'effective host depth'};},
  createEncoder() {events.push('create-volume-encoder'); return next;},
});
assert.equal(result,next);
assert.deepEqual(events,['encode-source','finish-source','submit-source','bind-host-input','render-host','create-volume-encoder']);
let consumed = false;
assert.throws(() => source.prepareSceneSourceFrame({encoder, encode:()=>prepared,
  submit(){throw new Error('submission rejected');},consume(){consumed=true;},renderHost(){consumed=true;},createEncoder(){consumed=true;}}), /submission rejected/);
assert.equal(consumed,false,'failed submission must not publish source to either consumer');
let volumeEncoderCreated = false;
assert.throws(() => source.prepareSceneSourceFrame({encoder, encode:()=>prepared,
  submit(){}, consume(){}, renderHost(){return null;},
  createEncoder(){volumeEncoderCreated=true;}}), /shared-scene-source-host-depth-unavailable/);
assert.equal(volumeEncoderCreated,false,'missing host depth must not admit a fallback volume draw');
console.log('scene source submission precedes host consumption; failed submission cannot publish');
