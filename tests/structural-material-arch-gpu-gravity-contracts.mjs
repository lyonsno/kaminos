import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { ArchGpuEngine } from '../dist/structural-material-arch-gpu-engine.js';

const engine = new ArchGpuEngine({ limits: {} }, { maxBodies: 2 });
engine.setGravity([0, -3, 0]);
assert.deepEqual(engine.config.gravity, [0, -3, 0]);
assert.throws(() => engine.setGravity([0, NaN, 0]), /finite/);
assert.deepEqual(engine.config.gravity, [0, -3, 0]);
engine.initialized = true;
engine.integration = { kernel: { computeNode: { parameters: {} } } };
assert.throws(() => engine.setGravity([0, -9.81, 0]), /uniform/);
assert.deepEqual(engine.config.gravity, [0, -3, 0], 'ABI drift must not mutate effective gravity');
const value = new Vector3(0, -3, 0);
engine.integration.kernel.computeNode.parameters.gravity = { value };
engine.setGravity([0, -9.81, 0]);
assert.deepEqual(value.toArray(), [0, -9.81, 0]);
assert.deepEqual(engine.getGravity(), [0, -9.81, 0]);
console.log('Pinned gravity adapter preserves prior config on ABI drift and exposes the bound uniform');
