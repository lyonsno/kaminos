import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pin = JSON.parse(readFileSync(new URL('./sam-mlx-reference-pin.json', import.meta.url)));

export function assertSam3SourceCode(source) {
  assert.equal(source?.clean, true, 'SAM reference source must be clean');
  assert.equal(source.commit, pin.commit, 'SAM reference source commit mismatch');
  assert.deepEqual(source.files, pin.files, 'SAM reference source hashes mismatch');
  assert.ok(typeof source.root === 'string' && source.root.startsWith('/'), 'SAM reference effective root missing');
}

export function assertSam3ReferenceIdentity(manifest) {
  const framework = manifest.reference?.framework;
  assertSam3SourceCode(framework?.sourceCode);
  assert.equal(framework.name, 'mlx-vlm');
  assert.equal(framework.root, framework.sourceCode.root, 'SAM reference root conflict');
  if (manifest.imageVitBlockStack) {
    const { patchHeight, patchWidth, visionWindowSize } = manifest.shape;
    assert.equal(patchHeight, patchWidth, 'SAM reference scaling admits square grids');
    const expected = {
      globalGrid: [patchHeight, patchWidth],
      globalCoordinateScale: visionWindowSize / patchHeight,
      windowCoordinateScale: 1,
      boxRpbCoordinates: 'index/size',
      referencePointOutputActivation: 'linear',
    };
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(manifest.reference.sam3Semantics?.[key], value, `SAM reference scaled-grid semantics mismatch: ${key}`);
    }
  }
}
