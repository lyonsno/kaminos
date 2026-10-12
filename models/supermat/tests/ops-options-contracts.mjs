// A misspelled or unsupported ops option must fail, not silently measure the
// default configuration (observed: stage witnesses dropped every option).
import assert from 'node:assert/strict';
import { createSuperMatOps } from '../supermat-ops.js';

const device = { features: new Set(['shader-f16']), limits: {} };
assert.throws(() => createSuperMatOps(device, { fusenorm: true }), /unknown SuperMat ops option: fusenorm/);
assert.throws(() => createSuperMatOps(device, { activations: 'f16', precision: 'f16-partial' }), /unknown SuperMat ops option: precision/);
const ops = createSuperMatOps(device, { label: 't', activations: 'f16', fuseNorm: true, gemmPrecision: 'f16-tiles' });
assert.deepEqual({ activations: ops.activations, fuseNorm: ops.fuseNorm, gemmPrecision: ops.gemmPrecision },
  { activations: 'f16', fuseNorm: true, gemmPrecision: 'f16-tiles' });
console.log('ops options contracts: 3 passed');
