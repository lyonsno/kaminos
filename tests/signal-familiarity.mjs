// kaminos-test: node
import assert from 'node:assert/strict';
import {createSignalFamiliarity} from '../experiments/creature-motion/signal-familiarity.mjs';

const memory=createSignalFamiliarity();
assert.equal(memory.observe({time:0,value:'off'}).familiarity,0,'first sample has no invented history');
memory.observe({time:30,value:'off'});
assert.ok(memory.observe({time:30,value:'on'}).familiarity<.01,'a new state has no exposure');
memory.observe({time:32,value:'on'});
assert.ok(memory.observe({time:32,value:'off'}).familiarity>.9,'a brief excursion leaves the familiar destination intact');
// Time before a transition belongs to the previous state, never the destination.
const long=createSignalFamiliarity();long.observe({time:0,value:'off'});long.observe({time:30,value:'on'});
assert.ok(long.observe({time:630,value:'off'}).familiarity<.05,'long on exposure replaces familiarity with off');
const levels=createSignalFamiliarity();levels.observe({time:0,value:1});levels.observe({time:30,value:1});
assert.ok(levels.observe({time:30,value:1.01}).familiarity>.95,'nearby brightness is familiar across a bin boundary');
assert.ok(levels.observe({time:30,value:8}).familiarity<.01,'a distant level is unfamiliar');
assert.throws(()=>levels.observe({time:29,value:1}),/backward/);
assert.throws(()=>levels.observe({time:31,value:NaN}),/finite/);
const gaps=createSignalFamiliarity();gaps.observe({time:0,value:'on'});gaps.observe({time:30,value:'on'});gaps.gap();
assert.ok(gaps.observe({time:3030,value:'on'}).familiarity<.01,'an unobserved gap ages memory without adding exposure');
console.log('Exposure belongs to observed states; familiar destinations survive brief excursions and fade during long ones');
