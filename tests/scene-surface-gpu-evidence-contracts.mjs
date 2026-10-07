import assert from 'node:assert/strict';
import {assertSurfaceGPUFrame} from '../scratch/beaming-surface-gpu-check.mjs';
const values=()=>[Array(28).fill(1),Array(28).fill(2)];
for(const name of ['lit','relit']) {
  const actual=values();actual[0][0]=NaN;
  assert.throws(()=>assertSurfaceGPUFrame(name,actual,values()),/nonfinite actual/,'NaN lit/relit readback must fail');
}
assert.equal(assertSurfaceGPUFrame('lit',values(),values()),0);
for(const value of [NaN,Infinity,-Infinity,null]) {
  const actual=values();actual[1][27]=value;
  assert.throws(()=>assertSurfaceGPUFrame('lit',actual,values()),/nonfinite actual/);
  const expected=values();expected[1][27]=value;
  assert.throws(()=>assertSurfaceGPUFrame('relit',values(),expected),/nonfinite expected/);
}
const mismatch=values();mismatch[0][0]=4;
assert.throws(()=>assertSurfaceGPUFrame('lit',mismatch,values()),/differs from CPU/);
assert.throws(()=>assertSurfaceGPUFrame('black',values(),values()),/retained previous-frame/);
console.log('GPU oracle evidence rejects nonfinite lit/relit output');
