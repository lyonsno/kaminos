import assert from 'node:assert/strict';

export function assertIgnitionCaptureState(state, expected) {
  assert.equal(state.backend, 'WebGPU:apple');
  assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(state.grid, 48);
  assert.deepEqual(state.gridDimensions, [48, 96, 48]);
  assert.equal(state.basin, 'vsp-13e22642e71f4ac8f758fae803a83110577ecc6d7ef9f233411e096af8e9097b');
  assert.equal(state.assembly?.structureCount, 2);
  assert.equal(state.assembly.meshTriangleCount, 1728);
  assert.ok(state.assembly.dispatchCount > 0);
  assert.equal(state.assembly.runtimeReadbackCount, 0);
  assert.equal(state.assembly.presentationDebugMode, expected.view);
  assert.equal(state.assembly.emittingObjectIds.length, expected.emissionEnabled ? 2 : 0);
  assert.equal(state.source?.sameDevice, true);
  assert.deepEqual(state.objects.map(object => object.id), expected.objectIds);
  for (const object of state.objects) assert.equal(object.combustionBinding.emissionEnabled, expected.emissionEnabled);
}
