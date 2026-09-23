import assert from 'node:assert/strict';

export function validateFieldArm(arm) {
  if (arm.field === true) assert.equal(arm.mode, 2, `field capture requires emissive transport: ${arm.id}`);
}

export function validateEmissiveField(field, files, expectedState, expected = { grid: 20, directions: 24 }) {
  assert.equal(field?.ok, true, 'missing field result');
  assert.equal(field.authority, 'same-submission-fluid-and-uniforms-gpu-field-readback-v1');
  assert.equal(field.grid, expected.grid);
  assert.equal(field.directions, expected.directions);
  assert.equal(field.simStepCount, expectedState.simStepCount, 'frame metadata mismatch: sim step');
  assert.equal(field.effectiveRoute, expectedState.effectiveRoute, 'frame metadata mismatch: route');
  assert.equal(field.backend, expectedState.backend, 'frame metadata mismatch: backend');
  assert.equal(field.physicalColor?.effective, expectedState.physicalColor?.effective, 'frame metadata mismatch: mode');
  assert.equal(field.physicalColor?.temperature, expectedState.physicalColor?.temperature, 'frame metadata mismatch: temperature');
  assert.equal(field.physicalColor?.exposureEV, expectedState.physicalColor?.exposureEV, 'frame metadata mismatch: exposure');

  const cells = field.grid ** 3;
  const expectedBytes = {
    coefficients: cells * 16,
    directionalRadiance: cells * field.directions * 16,
    incidentRadiance: cells * 16,
  };
  const arrays = {};
  for (const [name, byteLength] of Object.entries(expectedBytes)) {
    const encoded = files?.[name];
    assert.equal(typeof encoded, 'string', `missing or partial ${name} field`);
    const bytes = Buffer.from(encoded, 'base64');
    assert.equal(bytes.byteLength, byteLength, `missing or partial ${name} field`);
    const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    assert.ok(values.every(Number.isFinite), `non-finite ${name} field`);
    arrays[name] = values;
  }

  let emission = 0, extinction = 0, directionalEnergy = 0, resolvedEnergy = 0;
  for (let cell = 0; cell < cells; cell++) {
    const base = cell * 4;
    for (let channel = 0; channel < 3; channel++) emission += Math.max(0, arrays.coefficients[base + channel]);
    extinction += Math.max(0, arrays.coefficients[base + 3]);
    for (let channel = 0; channel < 3; channel++) resolvedEnergy += Math.abs(arrays.incidentRadiance[base + channel]);
  }
  for (const value of arrays.directionalRadiance) directionalEnergy += Math.abs(value);
  assert.ok(emission > 0 && extinction > 0 && directionalEnergy > 0 && resolvedEnergy > 0, 'blank field');

  let maxAbsoluteError = 0, maxMagnitude = 0;
  for (let cell = 0; cell < cells; cell++) for (let channel = 0; channel < 3; channel++) {
    let mean = 0;
    for (let direction = 0; direction < field.directions; direction++) {
      mean += arrays.directionalRadiance[(direction * cells + cell) * 4 + channel] / field.directions;
    }
    const resolved = arrays.incidentRadiance[cell * 4 + channel];
    maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(mean - resolved));
    maxMagnitude = Math.max(maxMagnitude, Math.abs(mean), Math.abs(resolved));
  }
  const maxRelativeResolveError = maxAbsoluteError / Math.max(maxMagnitude, 1e-12);
  assert.ok(maxRelativeResolveError <= 1e-5, `directional mean mismatch: ${maxRelativeResolveError}`);
  return { expectedBytes, maxAbsoluteResolveError: maxAbsoluteError, maxRelativeResolveError, emission, extinction, directionalEnergy, resolvedEnergy };
}

export function snapshotEmissiveFieldFrame(sourceIndex, state) {
  return {
    sourceIndex,
    simStepCount: state.simStepCount,
    effectiveRoute: state.effectiveRoute,
    physicalColor: structuredClone(state.physicalColor),
    backend: state.backend,
  };
}

// Optional exact control-isolation relation, never an artistic completion test.
// Caller has already checked effective route, frozen state and complete RGBA.
export function assertArmEquivalent(arm, rgba, earlier) {
  if (arm.equalTo === undefined) return;
  assert.equal(typeof arm.equalTo,'string','equalTo must name a prior arm');
  assert.ok(earlier.has(arm.equalTo),`prior arm missing: ${arm.equalTo}`);
  assert.ok(rgba.equals(earlier.get(arm.equalTo)),`raw RGBA differs: ${arm.id} != ${arm.equalTo}`);
}
