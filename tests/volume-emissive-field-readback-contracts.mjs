import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const transport = readFileSync(new URL('../volume-emissive-transport.mjs', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-physical-color-witness.mjs', import.meta.url), 'utf8');
const witnessContracts = await import('../volume-physical-color-witness-contract.mjs');
const { snapshotEmissiveFieldFrame } = await import('../volume-emissive-transport.mjs');

const allocation = transport.split('export function createEmissiveLightField')[1]?.split('\n}\n')[0] ?? '';
const fieldReadback = core.split('async function sampleEmissiveLightField()')[1]?.split('\n  async function ')[0] ?? '';

assert.match(allocation, /const allocate =[^\n]*GPUBufferUsage\.STORAGE \| GPUBufferUsage\.COPY_SRC/);
assert.match(allocation, /const coefficients = allocate\(/);
assert.match(allocation, /const directions = allocate\(/);
assert.match(allocation, /const incident = allocate\(/);
assert.match(allocation, /return \{\s*coefficients,\s*directions,\s*incident,/);
assert.match(fieldReadback, /emissiveLightField\.encode\(encoder,\s*capture\.sourceIndex\)/, 'readback must solve the held current field before copying');
assert.match(fieldReadback, /\['coefficients', emissiveLightField\.coefficients, bytes\]/);
assert.match(fieldReadback, /\['directions', emissiveLightField\.directions, bytes \* EMISSIVE_LIGHT_DIRECTION_COUNT\]/);
assert.match(fieldReadback, /\['incident', emissiveLightField\.incident, bytes\]/);
assert.match(fieldReadback, /fields\.forEach\(\(\[, source\], index\) => encoder\.copyBufferToBuffer\(source/);
assert.doesNotMatch(fieldReadback, /updateUniforms\(/, 'diagnostic must retain the render frame uniforms');
assert.match(fieldReadback, /grid:\s*EMISSIVE_LIGHT_GRID/);
assert.match(fieldReadback, /directions:\s*EMISSIVE_LIGHT_DIRECTION_COUNT/);
assert.match(fieldReadback, /Float32Array/);
assert.doesNotMatch(fieldReadback, /slice\(0,\s*(?:[0-9]+|EMISSIVE_LIGHT_GRID)/, 'readback must not silently truncate the diagnostic fields');
assert.match(core, /sampleEmissiveLightField,/);
assert.match(witness, /core\.sampleEmissiveLightField\(\)/);
assert.match(witness, /field\s*:\s*field\s*\?/);
assert.match(witness, /writeFileSync\(join\(out, `\$\{arm\.id\}\.\$\{name\}\.f32`/);
assert.match(witness, /validateEmissiveField\(result\.emissiveField, result\.fieldFiles, result\.state\)/);
assert.match(witness, /if \(arm\.field === true\)/);

assert.equal(typeof witnessContracts.validateEmissiveField, 'function', 'requested field evidence needs semantic validation');
assert.equal(typeof witnessContracts.validateFieldArm, 'function', 'field requests must reject unsupported modes');
assert.equal(typeof snapshotEmissiveFieldFrame, 'function', 'production readback metadata must be snapshotted before mapping');
const floatFile = values => Buffer.from(new Float32Array(values).buffer).toString('base64');
const field = {
  ok: true,
  authority: 'same-submission-fluid-and-uniforms-gpu-field-readback-v1',
  grid: 1,
  directions: 2,
  sourceIndex: 0,
  simStepCount: 7,
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  renderPhaseTimeMs: 1000,
  renderPhaseFrame: 160,
  renderPhaseAuthority: 'live-render-phase',
  physicalColor: { effective: 'emissive-transport-v2', incidentLight: { sourceIndex: 0 }, material: { smokeExtinction: 1, scatteringAlbedo: 0.25, ambientRadiance: 0.1 } },
};
const expected = { ...field };
const files = {
  coefficients: floatFile([1, 0.25, 0.1, 1]),
  directionalRadiance: floatFile([1, 2, 3, 0, 3, 4, 5, 0]),
  incidentRadiance: floatFile([2, 3, 4, 1]),
};
assert.equal(witnessContracts.validateEmissiveField(field, files, expected, { grid: 1, directions: 2 }).maxRelativeResolveError, 0);
assert.throws(() => witnessContracts.validateFieldArm({ field: true, mode: 0 }), /requires emissive transport/);
assert.throws(() => witnessContracts.validateEmissiveField(field, { ...files, incidentRadiance: undefined }, expected, { grid: 1, directions: 2 }), /missing or partial/);
assert.throws(() => witnessContracts.validateEmissiveField(field, {
  coefficients: floatFile([0, 0, 0, 0]), directionalRadiance: floatFile(Array(8).fill(0)), incidentRadiance: floatFile([0, 0, 0, 0]),
}, expected, { grid: 1, directions: 2 }), /blank field/);
assert.throws(() => witnessContracts.validateEmissiveField(field, { ...files, incidentRadiance: floatFile([NaN, 3, 4, 1]) }, expected, { grid: 1, directions: 2 }), /non-finite/);
assert.throws(() => witnessContracts.validateEmissiveField(field, { ...files, incidentRadiance: floatFile([2.2, 3, 4, 1]) }, expected, { grid: 1, directions: 2 }), /directional mean mismatch/);
assert.throws(() => witnessContracts.validateEmissiveField(field, files, { ...expected, simStepCount: 8 }, { grid: 1, directions: 2 }), /frame metadata mismatch/);
assert.throws(() => witnessContracts.validateEmissiveField({ ...field, sourceIndex: 1 }, files, expected, { grid: 1, directions: 2 }), /source index mismatch/);
assert.throws(() => witnessContracts.validateEmissiveField({ ...field, renderPhaseTimeMs: 1001 }, files, expected, { grid: 1, directions: 2 }), /render phase mismatch/);
assert.throws(() => witnessContracts.validateEmissiveField({ ...field, physicalColor: { ...field.physicalColor, material: { ...field.physicalColor.material, smokeExtinction: 3 } } }, files, expected, { grid: 1, directions: 2 }), /material state mismatch/);
const liveState = { simStepCount: 7, effectiveRoute: field.effectiveRoute, backend: 'WebGPU:apple', renderPhaseTimeMs: 1000, renderPhaseFrame: 160, renderPhaseAuthority: 'live-render-phase', physicalColor: { effective: 'emissive-transport-v2', material: { ambientRadiance: 0 } } };
const snapshot = snapshotEmissiveFieldFrame(0, liveState);
liveState.simStepCount = 8; liveState.renderPhaseTimeMs = 2000; liveState.physicalColor.material.ambientRadiance = 1;
assert.equal(snapshot.simStepCount, 7);
assert.equal(snapshot.renderPhaseTimeMs, 1000);
assert.equal(snapshot.physicalColor.material.ambientRadiance, 0);
assert.match(fieldReadback, /snapshotEmissiveFieldFrame\(currentFluid, state\)/);
assert.match(fieldReadback, /emissiveLightField\.encode\(encoder,\s*capture\.sourceIndex\)/);
assert.match(fieldReadback, /\.\.\.capture/);
assert.ok(fieldReadback.indexOf('snapshotEmissiveFieldFrame(currentFluid, state)') < fieldReadback.indexOf('mapAsync'));
assert.ok(witness.indexOf('core.sampleEmissiveLightField()') < witness.indexOf('core.sampleEmissiveLightProfile()'), 'field capture must precede optional timing uniform updates');
assert.ok(witness.indexOf('const captureState = core.debugState()') < witness.indexOf('core.sampleEmissiveLightField()'), 'camera state must be captured before field mapping and optional profiling');
assert.match(witness, /state:captureState/);
assert.match(witness, /profileState:core\.debugState\(\)/);
assert.match(witness, /sourceIndex:field\.sourceIndex/);
assert.match(witness, /state\.renderPhaseTimeMs, result\.sample\.renderPhaseTimeMs/);
assert.match(witness, /state\.renderPhaseFrame, result\.sample\.renderPhaseFrame/);

console.log('emissive field readback: complete same-state source, directional, and resolved fields are retained');
