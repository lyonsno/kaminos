// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDriftReplayRoute} from '../open-world-drift-contract.mjs';
const live=()=>({controls:{windStrength:0,pressureSolver:'converged-open-top',waveletTurbulence:1},simGridDimensions:[32,64,32],pressureResolution:{effective:'half'},pressureSolver:{effective:{solver:'converged'}},openWorldBoundary:{effective:'ambient-pressure-open-faces'},worldSmoke:{effective:'one-way-world-field',flowDims:[8,16,8],materialDims:[32,64,32]},error:null});
test('replay accepts the effective open boundary route',()=>assert.doesNotThrow(()=>assertDriftReplayRoute(live(),'half')));
test('legacy boundary cannot masquerade as open-world drift evidence',()=>{
  const state=live();state.openWorldBoundary.effective='legacy-boundaries';
  assert.throws(()=>assertDriftReplayRoute(state,'half'),/open/);
});
test('missing boundary evidence cannot pass',()=>{
  const state=live();delete state.openWorldBoundary;
  assert.throws(()=>assertDriftReplayRoute(state,'half'),/open/);
});
test('disabled world, fallback pressure and wrong dimensions cannot pass',()=>{
  for(const mutate of [
    s=>s.worldSmoke.effective='off',
    s=>s.pressureSolver.effective.solver='legacy',
    s=>s.simGridDimensions=[64,128,64],
    s=>s.worldSmoke.flowDims=[16,32,16],
  ]) { const state=live(); mutate(state); assert.throws(()=>assertDriftReplayRoute(state,'half',live())); }
});
test('unexpected physics changes fail, explicit diagnostic overrides are checked',()=>{
  const state=live();state.controls.waveletTurbulence=0;
  assert.throws(()=>assertDriftReplayRoute(state,'half',live()),/waveletTurbulence/);
  assert.doesNotThrow(()=>assertDriftReplayRoute(state,'half',live(),{waveletTurbulence:0}));
  assert.throws(()=>assertDriftReplayRoute(state,'half',live(),{waveletTurbulence:0.5}),/waveletTurbulence/);
});
