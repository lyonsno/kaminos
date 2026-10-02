import assert from 'node:assert/strict';
import {createWebGPUFingerFluidSolver} from '../finger-fluid-webgpu-core.js';
await assert.rejects(createWebGPUFingerFluidSolver({packedDensity:'yes'}),/packed density.*boolean/i);
console.log('packed density API contracts passed');
