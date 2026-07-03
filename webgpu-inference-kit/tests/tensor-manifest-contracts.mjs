import assert from 'node:assert/strict';

import {
  defineTensorManifest,
  validateTensorManifest,
} from '../src/index.js';

const manifest = defineTensorManifest({
  modelId: 'Ruicheng/moge-2-vitl-normal',
  revision: 'local-fixture',
  weightFormat: 'kaminos.tensor-manifest.v0',
  tensors: [
    { name: 'neck.resamplers.1.0.weight', dtype: 'fp32', shape: [256, 128, 2, 2], byteOffset: 0, byteLength: 524288 },
    { name: 'neck.resamplers.1.0.bias', dtype: 'fp32', shape: [128], byteOffset: 524288, byteLength: 512 },
  ],
});

assert.equal(manifest.schema, 'kaminos.tensor-manifest.v0');
assert.equal(manifest.tensors[0].elements, 131072);
assert.equal(manifest.tensors[0].bytesPerElement, 4);
assert.equal(validateTensorManifest(manifest).ok, true);

const badDtype = defineTensorManifest({
  modelId: 'broken',
  revision: 'local-fixture',
  tensors: [
    { name: 'bad.tensor', dtype: 'floatish', shape: [1], byteOffset: 0, byteLength: 4 },
  ],
});
const badDtypeResult = validateTensorManifest(badDtype);
assert.equal(badDtypeResult.ok, false);
assert.match(badDtypeResult.errors.join('\n'), /unsupported dtype/);

const truncated = {
  ...manifest,
  tensors: [
    { ...manifest.tensors[0], byteLength: 12 },
  ],
};
const truncatedResult = validateTensorManifest(truncated);
assert.equal(truncatedResult.ok, false);
assert.match(truncatedResult.errors.join('\n'), /byteLength/);

console.log('tensor manifest contracts passed');
