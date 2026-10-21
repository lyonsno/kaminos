// kaminos-test: node
// The PLY point-cloud parser and splat crop math behind cheap splat previews,
// exercised on small PLY files built here instead of pinned as index.html text.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePlyPointCloud,
  createSplatPointSubsetGeometry,
  splatPointInsideCrop,
  chooseSplatCropFrame,
} from '../splat-point-cloud.mjs';

const encode = text => new TextEncoder().encode(text).buffer;

function binaryPly(header, writeBody, bodyBytes) {
  const head = new TextEncoder().encode(header);
  const bytes = new Uint8Array(head.byteLength + bodyBytes);
  bytes.set(head, 0);
  writeBody(new DataView(bytes.buffer, head.byteLength));
  return bytes.buffer;
}

test('an ASCII PLY with RGB colors normalizes positions into a 2-unit box and colors into 0..1', () => {
  const cloud = parsePlyPointCloud(encode([
    'ply', 'format ascii 1.0', 'element vertex 2',
    'property float x', 'property float y', 'property float z',
    'property uchar red', 'property uchar green', 'property uchar blue',
    'end_header', '0 0 0 255 0 0', '4 2 0 0 51 255', '',
  ].join('\n')));
  assert.equal(cloud.format, 'ascii');
  assert.equal(cloud.pointCount, 2);
  assert.equal(cloud.colorSource, 'rgb');
  assert.deepEqual(Array.from(cloud.positions), [-1, -0.5, 0, 1, 0.5, 0]);
  assert.deepEqual(Array.from(cloud.colors).map(v => Math.round(v * 1000) / 1000), [1, 0, 0, 0, 0.2, 1]);
  assert.deepEqual(cloud.bounds.size, [4, 2, 0]);
});

test('a little-endian binary PLY with spherical-harmonic DC colors reads them through the SH constant', () => {
  const header = [
    'ply', 'format binary_little_endian 1.0', 'element vertex 1',
    'property float x', 'property float y', 'property float z',
    'property float f_dc_0', 'property float f_dc_1', 'property float f_dc_2',
    'end_header', '',
  ].join('\n');
  const cloud = parsePlyPointCloud(binaryPly(header, view => {
    [1, 2, 3, 0, 1, -10].forEach((value, i) => view.setFloat32(i * 4, value, true));
  }, 24));
  assert.equal(cloud.format, 'binary_little_endian');
  assert.equal(cloud.colorSource, 'sh-dc');
  const [r, g, b] = Array.from(cloud.colors);
  assert.equal(r, 0.5);
  assert.ok(Math.abs(g - (0.5 + 0.28209479177387814)) < 1e-6);
  assert.equal(b, 0);
});

test('malformed PLY input fails with a named reason', () => {
  assert.throws(() => parsePlyPointCloud(encode('ply\nformat ascii 1.0\n')), /missing end_header/);
  assert.throws(() => parsePlyPointCloud(encode('obj\nend_header\n')), /not a PLY file/);
  assert.throws(() => parsePlyPointCloud(encode('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nend_header\n1 2\n')), /missing z/);
});

test('a subset geometry copies only the chosen points', () => {
  const positions = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const geometry = createSplatPointSubsetGeometry(positions, colors, [2, 0]);
  assert.deepEqual(Array.from(geometry.getAttribute('position').array), [2, 2, 2, 0, 0, 0]);
  assert.deepEqual(Array.from(geometry.getAttribute('color').array), [0, 0, 1, 1, 0, 0]);
});

test('crops are judged in axis-flipped coordinates, falling back to a legacy frame only when the canonical one is empty', () => {
  const sourcePositions = new Float32Array([0.5, 0, 0, -0.5, 0, 0]);
  const flipX = { axisFlips: [-1, 1, 1], centroidOffset: [0, 0, 0] };
  assert.equal(splatPointInsideCrop(sourcePositions, 0, flipX, [-1, -1, -1], [0, 1, 1]), true);
  assert.equal(splatPointInsideCrop(sourcePositions, 1, flipX, [-1, -1, -1], [0, 1, 1]), false);
  const preview = { sourcePositions, totalPointCount: 2 };
  assert.deepEqual(
    chooseSplatCropFrame(preview, flipX, [-1, -1, -1], [0, 1, 1]),
    { frame: 'axis-flipped-asset', includedPointCount: 1, canonicalPointCount: 1 },
  );
  const offset = { axisFlips: [1, 1, 1], centroidOffset: [5, 0, 0] };
  const chosen = chooseSplatCropFrame(preview, offset, [-6, -1, -1], [-4, 1, 1]);
  assert.equal(chosen.frame, 'pivot-local-minus-centroid');
  assert.equal(chosen.includedPointCount, 2);
  assert.equal(chosen.canonicalPointCount, 0);
});

test('when only the raw normalized frame contains points, the crop falls back to it and reports every frame\'s count', () => {
  const sourcePositions = new Float32Array([0.5, 0, 0]);
  const flippedAndOffset = { axisFlips: [-1, 1, 1], centroidOffset: [5, 0, 0] };
  assert.deepEqual(
    chooseSplatCropFrame({ sourcePositions, totalPointCount: 1 }, flippedAndOffset, [0.4, -1, -1], [0.6, 1, 1]),
    { frame: 'raw-normalized', includedPointCount: 1, canonicalPointCount: 0, pivotLocalPointCount: 0, rawNormalizedPointCount: 1 },
  );
});
