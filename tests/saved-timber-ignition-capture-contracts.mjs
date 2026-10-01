import assert from 'node:assert/strict';
import {assertIgnitionCaptureState} from '../artifacts/sinter-authored-mesh-smoke-0923/ignition-capture-contract.mjs';

const expected = {emissionEnabled: true, objectIds: ['source', 'receiver'], view: 'material'};
const state = {
  backend: 'WebGPU:apple', effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  grid: 48, gridDimensions: [48, 96, 48],
  basin: 'vsp-13e22642e71f4ac8f758fae803a83110577ecc6d7ef9f233411e096af8e9097b',
  assembly: {structureCount: 2, meshTriangleCount: 1728, emittingObjectIds: [1, 2], runtimeReadbackCount: 0, dispatchCount: 5, presentationDebugMode: 'material'},
  source: {sameDevice: true},
  objects: expected.objectIds.map(id => ({id, combustionBinding: {emissionEnabled: true}})),
};
assert.doesNotThrow(() => assertIgnitionCaptureState(state, expected));
for (const bad of [
  {...state, backend: 'unavailable'},
  {...state, effectiveRoute: 'plate-fallback'},
  {...state, grid: 96},
  {...state, gridDimensions: [48, 48, 48]},
  {...state, basin: 'default'},
  {...state, assembly: null},
  {...state, assembly: {...state.assembly, structureCount: 1}},
  {...state, assembly: {...state.assembly, dispatchCount: 0}},
  {...state, assembly: {...state.assembly, runtimeReadbackCount: 1}},
  {...state, assembly: {...state.assembly, presentationDebugMode: 'off'}},
  {...state, source: {sameDevice: false}},
  {...state, objects: [state.objects[0]]},
  {...state, objects: state.objects.map(object => ({...object, combustionBinding: {emissionEnabled: false}}))},
]) {
  assert.throws(() => assertIgnitionCaptureState(bad, expected), undefined,
    'fallback, stale/default config, missing object or emission substitution cannot close the capture');
}
const quiet = {...state, assembly: {...state.assembly, emittingObjectIds: []}, objects: state.objects.map(object => ({...object, combustionBinding: {emissionEnabled: false}}))};
assert.doesNotThrow(() => assertIgnitionCaptureState(quiet, {...expected, emissionEnabled: false}));
assert.throws(() => assertIgnitionCaptureState({...quiet, assembly: state.assembly}, {...expected, emissionEnabled: false}));
console.log('saved timber ignition capture contracts: ok');
