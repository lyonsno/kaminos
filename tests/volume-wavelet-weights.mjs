// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as wavelet from '../volume-wavelet-turbulence.mjs';
test('strength admits the operator-requested range above four',()=>{
  for(const strength of [4,8,12,16])assert.equal(wavelet.resolveWaveletTurbulence({waveletStrength:strength}).strength,strength);
});
test('independent octave multipliers preserve the default and can isolate either band',()=>{
  const p=[3.17,8.21,-4.53],base=wavelet.waveletDetailVelocity(p,2);
  assert.deepEqual(wavelet.resolveWaveletTurbulence({}).octaveWeights,[1,1]);
  assert.deepEqual(wavelet.waveletDetailVelocity(p,2,[1,1]),base);
  assert.deepEqual(wavelet.waveletDetailVelocity(p,2,[0,0]),[0,0,0]);
  const first=wavelet.waveletDetailVelocity(p,2,[1,0]),second=wavelet.waveletDetailVelocity(p,2,[0,1]);
  assert.deepEqual(first,wavelet.waveletDetailVelocity(p,1));
  for(let i=0;i<3;i++)assert.ok(Math.abs(first[i]+second[i]-base[i])<1e-12);
  assert.deepEqual(wavelet.waveletDetailVelocity(p,1,[0,1]),[0,0,0]);
  const r=wavelet.resolveWaveletTurbulence({waveletOctave1Weight:.2,waveletOctave2Weight:.8});
  assert.deepEqual(r.octaveWeights,[.2,.8]);
  assert.deepEqual(wavelet.waveletOctaveUniformValues(r).slice(0,2),[.2,.8]);
});
test('weighted feedback calibration preserves old defaults and stays finite for zero weights',()=>{
  assert.equal(wavelet.waveletDetailReadGain(1,[1,1]),.503);
  assert.ok(Math.abs(wavelet.waveletDetailReadGain(2,[1,1])-.648)<1e-12);
  assert.equal(wavelet.waveletDetailReadGain(2,[1,0]),.503);
  assert.ok(Number.isFinite(wavelet.waveletDetailReadGain(2,[0,0])));
  assert.equal(wavelet.waveletDetailRms(2,[0,0]),0);
});
