// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '../lib/three.core.js';
import { HAND_VIEW, palmFrame, wristBoundary, createVirtualHand } from '../experiments/iron-gland/virtual-hand.mjs';

const vertices = () => {
  const v=new Float32Array(778*3);
  v.set([.04,-.07,0],62*3);v.set([-.04,-.07,0],595*3);v.set([.08,-.04,-.01],744*3);
  return v;
};
test('opposite view puts the right thumb on the left and the palm normal away from the viewer',()=>{
  const v=vertices(),p=palmFrame(v,[0,1,2],'right');
  assert.ok(v[744*3]*HAND_VIEW[0]<0);
  assert.ok(p.normal.z<-.99,'camera-facing palm now faces away, exposing the back');
  assert.equal(HAND_VIEW.reduce((a,b)=>a*b,1),1,'view is a rotation, not a reflected anatomy');
  assert.ok(new Vector3(0,0,1).applyQuaternion(p.quaternion).distanceTo(p.normal)<1e-7);
  assert.ok(Math.abs(p.width-.08)<1e-6);
});
test('the left-hand producer reflection keeps the palm frame and reverses mesh winding exactly once',()=>{
  const right=vertices(),left=right.map((v,i)=>i%3===0?-v:v), faces=new Uint16Array([0,1,2]);
  const hand=createVirtualHand();
  const p=hand.update({hasHand:true,verticesMeters:left,handedness:'left'},faces);
  assert.ok(p.normal.z<-.99);
  assert.deepEqual(Array.from(hand.root.children[0].geometry.index.array),[0,2,1]);
  hand.update({hasHand:true,verticesMeters:right,handedness:'right'},faces);
  assert.deepEqual(Array.from(hand.root.children[0].geometry.index.array),[0,1,2]);
  assert.equal(hand.root.children[0].material.depthWrite,true);
});
test('only open boundary edges define the wrist; misses and malformed geometry hide the hand',()=>{
  assert.deepEqual(wristBoundary([0,1,2,2,1,3]).sort(),[0,1,2,3]);
  const h=createVirtualHand(),v=vertices(),faces=new Uint16Array([0,1,2]);
  assert.ok(h.update({hasHand:true,verticesMeters:v,handedness:'right'},faces));
  v[90]=NaN;
  assert.equal(h.update({hasHand:true,verticesMeters:v,handedness:'right'},faces),null);
  assert.equal(h.root.visible,false);
  assert.equal(h.update({hasHand:false},faces),null);
});
