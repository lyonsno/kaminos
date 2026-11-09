// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as jax from '@jax-js/jax';
import {runNumericalChecks} from './checks.mjs';
import {fixture,reference,compare,finiteDifference,objective} from './reference.mjs';
import {validateBrowserResult} from './validation.mjs';
test('recurrence sequence, final state, all input gradients and split continuation',async()=>{
  await jax.init('wasm');
  const results=await runNumericalChecks(jax,'wasm');
  assert.deepEqual(results.map(x=>x.caseName),['forward','forward','gradient','split-continuation']);
  assert.deepEqual(Object.keys(results.find(x=>x.caseName==='gradient').errors).sort(),['beta','k','logDecay','q','state','v']);
});
test('numerical comparison rejects finite wrong output, missing entries and NaN',()=>{
  const expected=reference(fixture()).output;
  assert.throws(()=>compare(expected.map(x=>x+0.1),expected),/numerical mismatch/);
  assert.throws(()=>compare([],expected),/length mismatch/);
  assert.throws(()=>compare(expected.map(()=>NaN),expected),/numerical mismatch/);
});
test('browser evidence rejects fallback, stale runs and incomplete numerical output',()=>{
  const expected={nonce:'this-run',vendor:'apple'};
  const f=fixture(),other=fixture({batch:2,steps:4,heads:2,keys:3,values:2});
  const valid={nonce:'this-run',backend:{vendor:'apple',effective:'webgpu'},
    cases:[{caseName:'forward',dims:f.dims,values:reference(f)},
      {caseName:'forward',dims:other.dims,values:reference(other)},
      {caseName:'gradient',dims:f.dims,values:finiteDifference(f),loss:objective(f)},
      {caseName:'split-continuation',dims:f.dims,values:reference(f)}],
    interop:{sameDevice:true,borrowedInputSurvived:true,deviceSurvived:true,
      transformed:reference(f).output.map(x=>2*x+1),afterDispose:reference(f).output,later:reference(f).output.map(x=>3*x)}};
  assert.equal(validateBrowserResult(valid,expected),valid);
  assert.throws(()=>validateBrowserResult({...valid,backend:{vendor:'google swiftshader',effective:'webgpu'}},expected),/vendor/);
  assert.throws(()=>validateBrowserResult({...valid,backend:{vendor:'apple',effective:'wasm'}},expected),/backend/);
  assert.throws(()=>validateBrowserResult({...valid,nonce:'old-run'},expected),/nonce/);
  assert.throws(()=>validateBrowserResult({...valid,cases:[]},expected),/cases/);
  // A successful-looking envelope with absent/wrong numbers must not close.
  const missing=structuredClone(valid);delete missing.cases[2].values.beta;
  assert.throws(()=>validateBrowserResult(missing,expected),/beta/);
  const wrong=structuredClone(valid);wrong.cases[0].values.output[0]+=0.1;
  assert.throws(()=>validateBrowserResult(wrong,expected),/numerical mismatch/);
  const wrongDims=structuredClone(valid);wrongDims.cases[1].dims.keys=1;
  assert.throws(()=>validateBrowserResult(wrongDims,expected),/dimensions/);
  const wrongInterop=structuredClone(valid);wrongInterop.interop.afterDispose=[];
  assert.throws(()=>validateBrowserResult(wrongInterop,expected),/length mismatch/);
});
