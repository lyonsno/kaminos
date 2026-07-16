import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(typeof kit.createSam3BrowserModelPackageRuntime, 'function');

const sharedSha = `sha256:${'a'.repeat(64)}`;
const uniqueSha = `sha256:${'b'.repeat(64)}`;
const manifest = {
  schema: kit.SAM3_BROWSER_MODEL_PACKAGE_SCHEMA,
  packageId: `sam3-model-package:sha256:${'c'.repeat(64)}`,
  model: { id: 'mlx-community/sam3-bf16', revision: 'fixture' },
  weights: [
    { role: 'vit-block0-q-proj-weight', file: 'block0-q.bin', sha256: sharedSha, byteLength: 16, dtype: 'float32', shape: [2, 2] },
    { role: 'vit-block-stack-layer0-q-proj-weight', file: 'stack0-q.bin', sha256: sharedSha, byteLength: 16, dtype: 'float32', shape: [2, 2] },
    { role: 'detr-query-weight', file: 'query.bin', sha256: uniqueSha, byteLength: 8, dtype: 'float32', shape: [2] },
  ],
};
const loads = [];
const runtime = kit.createSam3BrowserModelPackageRuntime({
  manifest,
  async loadUint8(entry) {
    loads.push(entry);
    return new Uint8Array(entry.byteLength);
  },
});

assert.equal(runtime.packageId, manifest.packageId);
assert.equal(runtime.modelPackage.staticArtifacts.length, 2, 'equal authenticated bytes must allocate once');
const shared = runtime.modelPackage.staticArtifacts.find(entry => entry.sha256 === sharedSha);
assert.equal(shared.aliases.length, 2, 'deduplicated bytes must retain both semantic weight aliases');
assert.deepEqual(shared.aliases.map(alias => alias.file).sort(), ['block0-q.bin', 'stack0-q.bin']);
assert.deepEqual(shared.aliases.map(alias => alias.role).sort(), ['vit-block-stack-layer0-q-proj-weight', 'vit-block0-q-proj-weight'].sort());
assert.equal((await runtime.loadUint8(shared)).byteLength, 16);
assert.equal(loads.length, 1);
assert.throws(
  () => kit.createSam3BrowserModelPackageRuntime({ manifest: { ...manifest, weights: [{ ...manifest.weights[0], byteLength: 12 }, manifest.weights[1]] }, loadUint8: runtime.loadUint8 }),
  /same sha256|byte length|conflicting/i,
  'equal content identity with conflicting byte contracts must fail closed',
);

console.log('sam3 browser model package runtime contracts passed');
