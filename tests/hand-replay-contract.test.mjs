// kaminos-test: node
import assert from 'node:assert/strict';
import {validateReplay, frameAtTime, ballisticArc} from '../experiments/hand-replay-contract.mjs';
const hand={status:'missing',reason:'no_detection'};
const data={schema:'hand-state.teacher-replay.v1',models:[{id:'a',checkpointSha256:'a'.repeat(64)},{id:'b',checkpointSha256:'b'.repeat(64)}],frames:[{captureId:'a',timeMs:0,image:'a.jpg',hands:[hand,hand]},{captureId:'b',timeMs:140,image:'b.jpg',hands:[hand,hand]},{captureId:'c',timeMs:360,image:'c.jpg',hands:[hand,hand]}]};
validateReplay(data);
assert.equal(frameAtTime(data.frames,139),0);assert.equal(frameAtTime(data.frames,140),1);assert.equal(frameAtTime(data.frames,350),1);assert.equal(frameAtTime(data.frames,900),2);
const partial=structuredClone(data);partial.frames[1].hands.pop();assert.throws(()=>validateReplay(partial),/incomplete/);
const stale=structuredClone(data);stale.frames[1].captureId='a';assert.throws(()=>validateReplay(stale),/capture/);
const bad=structuredClone(data);bad.frames[0].hands[0]={status:'observed',vertices:[],joints:[]};assert.throws(()=>validateReplay(bad),/geometry/);
const arc=ballisticArc([0,0,0],[1,0,0],1,-.25);
assert(Math.abs(arc.at(-1)[1]+.25)<1e-8);assert(Math.abs(arc.at(-1)[0]-Math.sqrt(.5/9.81))<1e-8);
assert.throws(()=>ballisticArc([0,0,0],[0,0,0],1,-.25),/direction/);
console.log('hand replay contract passed');
