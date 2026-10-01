import assert from 'node:assert/strict';
import { acceptLearnObservations } from './learn-observation-acceptance.mjs';
import { featurePixels } from '../sf3d-learn-features.mjs';
const samples = Array.from({ length: 24 }, (_, i) => ({ kind: 'encoder', completedBlocks: i + 1, totalBlocks: 24,
  width: 36, height: 36, values: Array(1296).fill(0.5), observationMs: 2, atMs: 10 + i }));
const mesh = { kind: 'mesh', numVertices: 3, numFaces: 1, atMs: 80 };
assert.equal(acceptLearnObservations([...samples, mesh], 100).readbackBytes, 124416);
assert.throws(() => acceptLearnObservations([...samples.slice(1), mesh], 100), /encoder/);
assert.throws(() => acceptLearnObservations(samples, 100), /mesh/);
assert.throws(() => acceptLearnObservations([...samples, { ...mesh, atMs: 101 }], 100), /mesh/);
assert.throws(() => acceptLearnObservations([...samples.toReversed(), mesh], 100), /encoder/);
assert.throws(() => acceptLearnObservations([{ ...samples[0], values: [NaN] }, ...samples.slice(1), mesh], 100), /encoder/);
const pixels = featurePixels(new Float32Array([-1, 0, 1]), 3, 1);
assert.equal(pixels.min, -1);
assert.equal(pixels.max, 1);
assert.notDeepEqual(pixels.pixels.slice(0, 4), pixels.pixels.slice(8, 12));
assert.throws(() => featurePixels(new Float32Array([NaN]), 1, 1), /Invalid/);
assert.throws(() => featurePixels(new Float32Array([1]), 2, 2), /Invalid/);
console.log('Learn observations reject incomplete/stale-shaped runs and invalid pixels');
