// kaminos-test: node
import assert from 'node:assert/strict';
import {beginContinuousPointer} from '../continuous-pointer.mjs';
const doc=new EventTarget();doc.defaultView={innerWidth:1000,innerHeight:800};let exits=0;doc.exitPointerLock=()=>{exits++;doc.pointerLockElement=null;doc.dispatchEvent(new Event('pointerlockchange'));};
const target={ownerDocument:doc,requestPointerLock(){doc.pointerLockElement=target;return Promise.resolve();}},moves=[];let lost=0;
const pointer=beginContinuousPointer(target,{x:100,y:200},{move:value=>moves.push(value),lost:()=>lost++});pointer.request();
assert.equal(pointer.locked,true,'Browser ownership is effective before notification');
const motion=(x,y)=>doc.dispatchEvent(Object.assign(new Event('mousemove'),{movementX:x,movementY:y}));
motion(20,-5);assert.equal(moves.length,1,'The first locked movement must be consumed before pointerlockchange arrives');assert.deepEqual([moves[0].x,moves[0].y],[120,195]);
doc.dispatchEvent(new Event('pointerlockchange'));motion(3,2);assert.deepEqual([moves[1].x,moves[1].y],[123,197]);
doc.pointerLockElement={};motion(10,10);assert.equal(moves.length,2,'A delayed loss notification cannot permit motion for another owner');doc.dispatchEvent(new Event('pointerlockchange'));assert.equal(lost,1);assert.equal(pointer.locked,false);pointer.stop();await Promise.resolve();await Promise.resolve();motion(50,50);assert.equal(moves.length,2);assert.equal(exits,0,'Lost ownership must not release another actor’s lock');
const cancelled=beginContinuousPointer(target,{x:0,y:0},{move(){throw Error('Cancelled drag moved');}});cancelled.request();cancelled.stop();doc.dispatchEvent(new Event('pointerlockchange'));motion(5,5);await Promise.resolve();await Promise.resolve();assert.equal(exits,1);
console.log('Native pointer ownership before notification, loss and cancelled handover');
