import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMISSIVE_LIGHT_GRID,
  EMISSIVE_LIGHT_DIRECTIONS,
  resolveEmissiveLightTransport,
  createEmissiveLightField,
  EMISSIVE_TRANSPORT_WGSL,
} from '../volume-emissive-transport.mjs';

const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const control = schema.controls.find(entry => entry.key === 'volume-emissive-light-transport');

assert.equal(schema.controlCount, schema.controls.length);
assert.deepEqual(control?.allowedValues, ['axes', 'oblique']);
assert.equal(control?.additiveDefault, 'axes');
assert.match(html, /id="volume-emissive-light-transport"/);
assert.match(core, /emissiveLightField\.encode\(encoder, currentFluid, [^\n]*lightTransport/);
assert.equal(resolveEmissiveLightTransport(undefined), 'axes');
assert.equal(resolveEmissiveLightTransport('oblique'), 'oblique');
assert.throws(() => resolveEmissiveLightTransport('unknown'), /unsupported.*light transport/);
assert.equal(EMISSIVE_LIGHT_GRID, 32, 'both arms use the existing coefficient grid');
assert.equal(EMISSIVE_LIGHT_DIRECTIONS.length, 24);

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
for (const direction of EMISSIVE_LIGHT_DIRECTIONS) {
  assert.ok(Math.abs(dot(direction, direction) - 1) < 1e-12);
  assert.ok(direction.every(value => Math.abs(value) > 0.08));
  assert.ok(EMISSIVE_LIGHT_DIRECTIONS.some(other => other.every((value, axis) => Math.abs(value + direction[axis]) < 1e-12)));
}
for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
  const moment = EMISSIVE_LIGHT_DIRECTIONS.reduce((sum, direction) => sum + direction[row] * direction[column], 0) / 24;
  assert.ok(Math.abs(moment - (row === column ? 1 / 3 : 0)) < 1e-12);
}

const slabResponse = (normal, basis) => basis.reduce((sum, direction) => {
  const cosine = Math.abs(dot(direction, normal));
  return sum + Math.exp(-1 / Math.max(cosine, 1e-9));
}, 0) / basis.length;
const normals = Array.from({ length: 1000 }, (_, index) => {
  const z = 1 - 2 * (index + 0.5) / 1000;
  const azimuth = index * 2.399963229728653;
  const radius = Math.sqrt(1 - z * z);
  return [radius * Math.cos(azimuth), radius * Math.sin(azimuth), z];
});
const responses = normals.map(normal => slabResponse(normal, EMISSIVE_LIGHT_DIRECTIONS));
const mean = responses.reduce((sum, value) => sum + value, 0) / responses.length;
const variation = Math.sqrt(responses.reduce((sum, value) => sum + (value - mean) ** 2, 0) / responses.length) / mean;
assert.ok(variation < 0.015, `oblique slab orientation variation ${variation}`);

assert.match(EMISSIVE_TRANSPORT_WGSL, /fn sweepObliqueEmissiveLight\(/);
assert.match(EMISSIVE_TRANSPORT_WGSL, /fn resolveObliqueEmissiveLight\(/);
assert.match(EMISSIVE_TRANSPORT_WGSL, /samplePreviousOutgoing\(direction/);
const priorUsage = globalThis.GPUBufferUsage;
globalThis.GPUBufferUsage = { STORAGE: 1, UNIFORM: 2 };
try {
  const device = {
    createBuffer: ({ size }) => ({ getMappedRange: () => new ArrayBuffer(size), unmap() {}, destroy() {} }),
    createComputePipeline: ({ compute }) => ({ name: compute.entryPoint, getBindGroupLayout: () => ({}) }),
    createBindGroup: ({ entries }) => entries,
  };
  const field = createEmissiveLightField(device, {}, {}, [{}, {}], [{}, {}]);
  const encode = mode => {
    const pipelines = [];
    const dispatches = [];
    const encoder = { beginComputePass: () => ({
      setPipeline: pipeline => pipelines.push(pipeline.name),
      setBindGroup() {},
      dispatchWorkgroups: (...shape) => dispatches.push(shape),
      end() {},
    }) };
    field.encode(encoder, 0, undefined, mode);
    return { pipelines, dispatches };
  };
  assert.deepEqual(encode('axes').pipelines, ['seedEmissiveLight', 'sweepEmissiveLight', 'resolveEmissiveLight']);
  const oblique = encode('oblique');
  assert.equal(oblique.pipelines.filter(name => name === 'sweepObliqueEmissiveLight').length, 1);
  assert.equal(oblique.dispatches.length, EMISSIVE_LIGHT_GRID + 2);
  assert.equal(oblique.pipelines.at(-1), 'resolveObliqueEmissiveLight');
  field.destroy();
} finally {
  globalThis.GPUBufferUsage = priorUsage;
}
console.log('oblique light mode: persisted legacy default, cubic directions, and transport path pass');
