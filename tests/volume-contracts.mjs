import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /data-tab="volume"/, 'sidebar exposes a Volume tab');
assert.match(index, /id="tab-volume"/, 'Volume tab content is present');
assert.match(index, /kaminos_volume_smoke/, 'URL route gate names the volume smoke prototype');
assert.match(index, /volume-core\.js/, 'index imports the volume prototype module');
assert.match(index, /initKaminosVolumeRoute/, 'index initializes the volume route explicitly');

const corePath = join(root, 'volume-core.js');
assert.ok(existsSync(corePath), 'volume-core.js exists');
const core = existsSync(corePath) ? readFileSync(corePath, 'utf8') : '';
assert.match(core, /export function createKaminosVolumePrototype/, 'volume module exports createKaminosVolumePrototype');
assert.match(core, /kaminos-volume-prototype-v0/, 'volume module exposes stable witness identity');
assert.match(core, /native-3d-compute-fluid-raymarch-v0/, 'volume module records compute-backed fluid route identity');
assert.match(core, /GRID_SIZE\s*=\s*64/, 'first fluid sim uses an explicit 64^3 grid size');
assert.match(core, /GPUBufferUsage\.STORAGE/, 'fluid state lives in WebGPU storage buffers');
assert.match(core, /createComputePipeline/, 'fluid state advances through a WebGPU compute pipeline');
assert.match(core, /dispatchWorkgroups/, 'fluid sim dispatches compute workgroups each frame');
assert.match(core, /simStepCount/, 'debug state exposes simulation step count');
assert.match(core, /simGrid/, 'debug state exposes simulation grid identity');

const witnessPath = join(root, 'volume-witness.mjs');
assert.ok(existsSync(witnessPath), 'volume-witness.mjs exists');
const witness = existsSync(witnessPath) ? readFileSync(witnessPath, 'utf8') : '';
assert.match(witness, /kaminos_volume_smoke=1/, 'witness captures the explicit volume route');
assert.match(witness, /effectiveRoute/, 'witness records effective route identity');
assert.match(witness, /native-3d-compute-fluid-raymarch-v0/, 'witness requires the compute-backed fluid route identity');
assert.match(witness, /simStepCount/, 'witness records simulation step count');
assert.match(witness, /simReadback/, 'witness records simulation readback evidence');
assert.match(witness, /blank frame/i, 'witness fails loudly on blank visual output');
