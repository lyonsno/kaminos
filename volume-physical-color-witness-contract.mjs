import assert from 'node:assert/strict';

export function validateFieldArm(arm) {
  if (arm.field === true) assert.equal(arm.mode, 2, `field capture requires emissive transport: ${arm.id}`);
}

export function assertArmControlsEffective(arm, state) {
  const expectedMode = arm.controls?.['volume-fire-render-mode'];
  if (expectedMode !== undefined) {
    assert.equal(state.fireRenderMode, expectedMode, `effective control mismatch: volume-fire-render-mode (${arm.id})`);
  }
}

export function validateEmissiveField(field, files, expectedState, expected = { grid: 20, directions: 24 }) {
  assert.equal(field?.ok, true, 'missing field result');
  assert.equal(field.authority, 'same-submission-fluid-and-uniforms-gpu-field-readback-v1');
  assert.equal(field.grid, expected.grid);
  assert.equal(field.directions, expected.directions);
  const requiredString = (value, label) => {
    assert.equal(typeof value, 'string', `missing frame identity: ${label}`);
    assert.ok(value.length > 0, `missing frame identity: ${label}`);
  };
  const requiredNumber = (value, label) => {
    assert.equal(typeof value, 'number', `missing frame identity: ${label}`);
    assert.ok(Number.isFinite(value), `missing frame identity: ${label}`);
  };
  const expectedColor = expectedState.physicalColor;
  const fieldColor = field.physicalColor;
  const identity = [
    ['sim step', field.simStepCount, expectedState.simStepCount, 'number'],
    ['route', field.effectiveRoute, expectedState.effectiveRoute, 'string'],
    ['backend', field.backend, expectedState.backend, 'string'],
    ['source index', field.sourceIndex, expectedColor?.incidentLight?.sourceIndex, 'number'],
    ['render phase time', field.renderPhaseTimeMs, expectedState.renderPhaseTimeMs, 'number'],
    ['render phase frame', field.renderPhaseFrame, expectedState.renderPhaseFrame, 'number'],
    ['render phase authority', field.renderPhaseAuthority, expectedState.renderPhaseAuthority, 'string'],
  ];
  for (const [label, value, expectedValue, type] of identity) {
    if (type === 'string') { requiredString(value, label); requiredString(expectedValue, label); }
    else { requiredNumber(value, label); requiredNumber(expectedValue, label); }
  }
  requiredString(fieldColor?.effective, 'physical color mode');
  requiredString(expectedColor?.effective, 'physical color mode');
  requiredString(fieldColor?.materialLawEffective, 'material law');
  requiredString(expectedColor?.materialLawEffective, 'material law');
  for (const key of ['temperature', 'temperatureSpread', 'thermalStrength', 'cleanStrength', 'exposureEV']) {
    requiredNumber(fieldColor?.[key], key);
    requiredNumber(expectedColor?.[key], key);
  }
  const fieldMaterial = fieldColor?.material;
  const expectedMaterial = expectedColor?.material;
  for (const key of ['smokeExtinction', 'scatteringAlbedo', 'ambientRadiance']) {
    requiredNumber(fieldMaterial?.[key], key);
    requiredNumber(expectedMaterial?.[key], key);
  }
  assert.equal(field.simStepCount, expectedState.simStepCount, 'frame metadata mismatch: sim step');
  assert.equal(field.effectiveRoute, expectedState.effectiveRoute, 'frame metadata mismatch: route');
  assert.equal(field.backend, expectedState.backend, 'frame metadata mismatch: backend');
  assert.equal(field.sourceIndex, expectedState.physicalColor?.incidentLight?.sourceIndex, 'source index mismatch');
  assert.equal(field.renderPhaseTimeMs, expectedState.renderPhaseTimeMs, 'render phase mismatch: time');
  assert.equal(field.renderPhaseFrame, expectedState.renderPhaseFrame, 'render phase mismatch: frame');
  assert.equal(field.renderPhaseAuthority, expectedState.renderPhaseAuthority, 'render phase mismatch: authority');
  assert.equal(field.physicalColor?.effective, expectedState.physicalColor?.effective, 'frame metadata mismatch: mode');
  for (const key of ['materialLawEffective', 'temperature', 'temperatureSpread', 'thermalStrength', 'cleanStrength', 'exposureEV']) {
    assert.equal(fieldColor[key], expectedColor[key], `physical color state mismatch: ${key}`);
  }
  for (const key of ['smokeExtinction', 'scatteringAlbedo', 'ambientRadiance']) {
    assert.equal(fieldMaterial[key], expectedMaterial[key], `material state mismatch: ${key}`);
  }

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

// Optional exact control-isolation relation, never an artistic completion test.
// Caller has already checked effective route, frozen state and complete RGBA.
export function assertArmEquivalent(arm, rgba, earlier) {
  if (arm.equalTo === undefined) return;
  assert.equal(typeof arm.equalTo,'string','equalTo must name a prior arm');
  assert.ok(earlier.has(arm.equalTo),`prior arm missing: ${arm.equalTo}`);
  assert.ok(rgba.equals(earlier.get(arm.equalTo)),`raw RGBA differs: ${arm.id} != ${arm.equalTo}`);
}
