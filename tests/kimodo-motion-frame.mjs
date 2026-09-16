import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// The observed live c input: an rAF callback queued before generation resolved.
const source=readFileSync(new URL('../kimodo-live-flame-inject.mjs',import.meta.url),'utf8');
const helpers=await import('../lib/kimodo-flame-evidence.mjs');
const expression=source.match(/const frame=(.*);/)[1];
const evaluate=new Function('now','playbackStart','motion','motionFrame',`return ${expression}`);
const motionFrame=(now,start,fps,numFrames)=>evaluate(now,start,{fps,numFrames},helpers.motionFrame);
assert.equal(motionFrame(99,100,30,180),0);
assert.equal(motionFrame(1100,100,30,180),30);
assert.equal(motionFrame(6100,100,30,180),0);
console.log('Playback frame bounds pass');
