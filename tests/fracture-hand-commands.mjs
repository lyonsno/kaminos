// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFractureHandCommands} from '../fracture-hand-commands.mjs';
function setup(){let target=null;const steps=[],calls=[];const model={setSurfaceHand:(_i,p)=>{target={...p};},moveHand:p=>{target={...p};},step:()=>{steps.push(target&&{...target});calls.push('step');},release:()=>{target=null;calls.push('release');}};return{hand:createFractureHandCommands(model),steps,calls};}
const origin={x:0,y:0,z:0},pull={x:1,y:0,z:0};
test('a moved hand released between frames submits its final target before release',()=>{const h=setup();h.hand.set(2,origin);h.hand.move(pull);h.hand.release();assert.deepEqual(h.steps,[pull]);assert.deepEqual(h.calls,['step','release']);h.hand.step();assert.equal(h.steps.at(-1),null);});
test('an already submitted target adds no release step; a later move is not lost',()=>{const h=setup();h.hand.set(2,origin);h.hand.move(pull);h.hand.step();h.hand.move({...pull});h.hand.release();assert.deepEqual(h.steps,[pull]);h.hand.set(3,origin);h.hand.step();h.hand.move(pull);h.hand.release();assert.deepEqual(h.steps,[pull,origin,pull]);});
test('click, cancellation, and replacement do not inject a deferred pull',()=>{const h=setup();h.hand.set(2,origin);h.hand.release();h.hand.set(2,origin);h.hand.move(pull);h.hand.cancel();h.hand.set(3,origin);h.hand.release();assert.deepEqual(h.steps,[]);});
test('failed final submission releases the hand and does not retry an old pull',()=>{let releases=0,steps=0;const hand=createFractureHandCommands({setSurfaceHand(){},moveHand(){},step(){steps++;throw Error('GPU failed');},release(){releases++;}});hand.set(2,origin);hand.move(pull);assert.throws(()=>hand.release(),/GPU failed/);assert.equal(releases,1);hand.release();assert.equal(steps,1);});
